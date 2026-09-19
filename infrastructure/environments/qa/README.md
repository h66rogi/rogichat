# QA root reservation

서울 Lightsail 1대, static IP, 최소 firewall, `qa.rogi.chat`·`api.qa.rogi.chat` DNS를 소유할 위치.
Tailscale + OpenSSH를 사용하고 공개키 파일은 Git 밖 입력으로 받는다.
AWS/Cloudflare root와 state key를 분리한다. 실제 secret이나 backend 파일을 넣지 않는다.
설계: [infrastructure-and-delivery](../../../docs/infrastructure-and-delivery.md).
