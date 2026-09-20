#!/usr/bin/env python3
"""Capture actual URLSession WebSocket headers/redirect behavior on loopback only.

This does not claim real QA authentication, device delivery or Socket.IO SDK
end-to-end success. No headers or credential-shaped fixture values are printed.
"""
import base64
import hashlib
from pathlib import Path
import socket
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[4]


def receive_exact(connection, count):
    data = b""
    while len(data) < count:
        chunk = connection.recv(count - len(data))
        if not chunk:
            raise AssertionError("unexpected test transport close")
        data += chunk
    return data


def scenario(executable, redirect):
    failures = []
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(2)
        server.settimeout(8)
        port = server.getsockname()[1]

        def serve():
            try:
                with server.accept()[0] as connection:
                    connection.settimeout(8)
                    request = b""
                    while b"\r\n\r\n" not in request:
                        request += receive_exact(connection, 1)
                        assert len(request) <= 8192, "oversize handshake"
                    lines = request.decode("ascii").split("\r\n")
                    headers = dict(line.split(": ", 1) for line in lines[1:] if ": " in line)
                    headers = {key.lower(): value for key, value in headers.items()}
                    assert "cookie" not in headers and "origin" not in headers, "ambient headers leaked"
                    assert headers.get("authorization") == "Bearer " + "A" * 43, "missing native header"
                    assert headers.get("x-rogi-client") == "ios", "missing native client"
                    if redirect:
                        response = f"HTTP/1.1 302 Found\r\nLocation: ws://127.0.0.1:{port}/forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        connection.sendall(response.encode("ascii"))
                    else:
                        accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
                        connection.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").encode("ascii"))
                        connection.sendall(b"\x81\x012")
                        prefix = receive_exact(connection, 2)
                        assert prefix[0] == 0x81 and prefix[1] == 0x81, "unexpected test frame"
                        mask = receive_exact(connection, 4)
                        assert bytes([receive_exact(connection, 1)[0] ^ mask[0]]) == b"3", "missing protocol pong"
                if redirect:
                    server.settimeout(1)
                    try:
                        unexpected, _ = server.accept()
                        unexpected.close()
                        raise AssertionError("redirect was followed")
                    except TimeoutError:
                        pass
            except BaseException as error:
                failures.append(error)

        thread = threading.Thread(target=serve)
        thread.start()
        subprocess.run([str(executable), f"ws://127.0.0.1:{port}/v1/realtime/?EIO=4&transport=websocket", "redirect" if redirect else "connect"], check=True, timeout=15)
        thread.join(timeout=10)
        assert not thread.is_alive(), "loopback server did not finish"
        if failures:
            raise AssertionError("loopback transport check failed") from failures[0]


def main():
    with tempfile.TemporaryDirectory(prefix="rogi-realtime-wire-") as temporary:
        executable = Path(temporary) / "wire-check"
        sources = ["Sources/Core/Realtime/RealtimeContract.swift", "Sources/Core/Realtime/RealtimeWebSocketRequest.swift", "Tests/Realtime/SocketTransportChecks.swift"]
        subprocess.run(["xcrun", "swiftc", "-swift-version", "6", "-strict-concurrency=complete", *(str(ROOT / "apps/ios" / path) for path in sources), "-o", str(executable)], check=True)
        scenario(executable, False)
        scenario(executable, True)
    print("Actual loopback transport: no cookies, no Origin, no redirect follow")


if __name__ == "__main__":
    main()
