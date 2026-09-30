#!/usr/bin/env python3
"""Explicit local QA release commands; never runs uploads as part of a build."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import sys

from release_common import APP_ID, DEFAULT_CONFIG, AppStoreConnect, config, external, private_write, run, version_name, version_number
import release_android
import release_ios
import release_finalize


def init_android(cfg):
    android = cfg["android"]
    key = external(android["keystore"])
    password_file = external(android["password_file"])
    if key.exists() or password_file.exists():
        raise ValueError("QA signing material already exists; refusing to overwrite")
    password = secrets.token_urlsafe(36)
    private_write(password_file, password + "\n")
    key.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    env = dict(os.environ, ROGICHAT_KEY_PASSWORD=password)
    run(["keytool", "-genkeypair", "-keystore", str(key), "-storetype", "JKS",
         "-storepass:env", "ROGICHAT_KEY_PASSWORD", "-keypass:env", "ROGICHAT_KEY_PASSWORD",
         "-alias", android["key_alias"], "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
         "-dname", "CN=Rogichat QA", "-noprompt"],
        external(cfg["artifact_root"]) / "signing-setup.log", env=env)
    key.chmod(0o600)
    print("New dedicated QA signing key created outside Git. Keep a private backup before distributing builds.")


def doctor(cfg):
    for command in ("java", "keytool", "jarsigner", "firebase", "xcodebuild", "xcrun"):
        print(command + ":", "available" if shutil.which(command) else "missing")
    for key in ("keystore", "password_file"):
        print("Android " + key + ":", "present" if external(cfg["android"][key]).is_file() else "missing")
    try:
        asc = AppStoreConnect(cfg)
        asc.bundle()
        print("Apple QA bundle: registered")
        asc.app()
        print("App Store Connect QA app: registered")
    except (ValueError, RuntimeError) as error:
        print("Apple:", error)
    if cfg["firebase"].get("project_id") and cfg["firebase"].get("app_id"):
        try:
            apps = release_android.firebase_json(["apps:list", "ANDROID", "--project", cfg["firebase"]["project_id"]], external(cfg["artifact_root"]), cfg)
            matches = [app for app in apps if app.get("appId") == cfg["firebase"]["app_id"] and app.get("packageName") == APP_ID]
            print("Firebase QA app:", "verified" if len(matches) == 1 else "missing/mismatched")
        except (ValueError, RuntimeError) as error:
            print("Firebase:", error)
    else:
        print("Firebase QA app: configure project_id and app_id after login/registration")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor")
    commands.add_parser("android-init-key")
    for name in ("android-build", "ios-archive"):
        sub = commands.add_parser(name)
        sub.add_argument("--build-number", type=version_number, required=True)
        sub.add_argument("--version", type=version_name, default="0.1.0")
    sub = commands.add_parser("android-upload")
    sub.add_argument("--manifest", type=Path, required=True)
    sub.add_argument("--notes-file", type=Path, required=True)
    for name in ("ios-export", "ios-upload"):
        sub = commands.add_parser(name)
        sub.add_argument("--manifest", type=Path, required=True)
    sub = commands.add_parser("ios-status")
    sub.add_argument("--build-number", type=version_number)
    sub = commands.add_parser("android-finalize", help="Verify uploaded APK and distribute only to the approved private tester file")
    sub.add_argument("--manifest", type=Path, required=True)
    sub.add_argument("--testers-file", type=Path, required=True)
    sub = commands.add_parser("ios-finalize", help="Verify the uploaded QA build, Korean notes and configured internal group")
    sub.add_argument("--manifest", type=Path, required=True)
    sub.add_argument("--notes-file", type=Path, required=True)
    sub.add_argument("--wait-seconds", type=int, default=0)
    args = parser.parse_args()
    os.umask(0o077)
    cfg = config(args.config)
    if args.command == "doctor":
        doctor(cfg)
    elif args.command == "android-init-key":
        init_android(cfg)
    elif args.command == "android-build":
        release_android.build(cfg, args.build_number, args.version)
    elif args.command == "android-upload":
        release_android.upload(cfg, args.manifest, args.notes_file)
    elif args.command == "ios-archive":
        release_ios.archive(cfg, args.build_number, args.version)
    elif args.command == "ios-export":
        release_ios.export(cfg, args.manifest)
    elif args.command == "ios-upload":
        release_ios.upload(cfg, args.manifest)
    elif args.command == "ios-status":
        release_ios.status(cfg, args.build_number)
    elif args.command == "android-finalize":
        release_finalize.android(cfg, args.manifest, args.testers_file)
    elif args.command == "ios-finalize":
        release_finalize.ios(cfg, args.manifest, args.notes_file, args.wait_seconds)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
