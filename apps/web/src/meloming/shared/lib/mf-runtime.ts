import { init } from "@module-federation/enhanced/runtime";
import React from "react";
import ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import { melomingUrl } from "@/meloming/shared/lib/service-routes";

// React를 MF global share cache에 직접 등록
// (remote의 loadShare 가상모듈이 동기적으로 찾을 수 있도록 -- MF runtime의
//  async init이 remote의 동기 loadShare 평가보다 늦어 null이 되는 문제 방지)
const g = globalThis as Record<string, unknown>;
const cache = (g.__mf_module_cache__ ??= { share: {}, remote: {} }) as {
  share: Record<string, unknown>;
  remote: Record<string, unknown>;
};
cache.share["default:react"] = React;
cache.share["react"] = React;
cache.share["default:react-dom"] = ReactDOM;
cache.share["react-dom"] = ReactDOM;
cache.share["default:react/jsx-runtime"] = jsxRuntime;
cache.share["react/jsx-runtime"] = jsxRuntime;

// QA 포털과 test.meloming.com = QA notify remote.
// 포털 루트 호스트(meloming.pri.sbalyd.com)는 mono의 ".<app>.meloming.pri" 접미사에
// 걸리지 않으므로 ".pri.sbalyd.com" 기준으로 판별한다.
function notificationsRemoteBase(): string {
  if (typeof window === "undefined") return "https://notify.meloming.com";
  const host = window.location.hostname;
  if (
    host === "test.meloming.com" ||
    host.endsWith(".pri.sbalyd.com") ||
    host.endsWith(".int.sbalyd.com")
  ) {
    return "https://notify.meloming.pri.sbalyd.com";
  }
  return "https://notify.meloming.com";
}

const notificationsRuntime = init({
  name: "meloming_front_notifications",
  remotes: [
    {
      name: "notifications",
      entry: `${notificationsRemoteBase()}/mfe/mf-manifest.json`,
    },
  ],
  shared: {
    react: {
      version: "19.2.5",
      scope: "default",
      lib: () => React,
      shareConfig: {
        singleton: true,
        requiredVersion: "^19.0.0",
      },
    },
    "react-dom": {
      version: "19.2.5",
      scope: "default",
      lib: () => ReactDOM,
      shareConfig: {
        singleton: true,
        requiredVersion: "^19.0.0",
      },
    },
    "react/jsx-runtime": {
      version: "19.2.5",
      scope: "default",
      lib: () => jsxRuntime,
      shareConfig: {
        singleton: true,
        requiredVersion: "^19.0.0",
      },
    },
  },
});

const globalChromeRuntime = init({
  name: "meloming_front_global_chrome",
  remotes: [
    {
      name: "global_chrome",
      entry: `${melomingUrl("chrome")}/mfe/mf-manifest.json`,
    },
  ],
  shared: {
    react: {
      version: "19.2.5",
      scope: "default",
      lib: () => React,
      shareConfig: { singleton: true, requiredVersion: "^19.0.0" },
    },
    "react-dom": {
      version: "19.2.5",
      scope: "default",
      lib: () => ReactDOM,
      shareConfig: { singleton: true, requiredVersion: "^19.0.0" },
    },
    "react/jsx-runtime": {
      version: "19.2.5",
      scope: "default",
      lib: () => jsxRuntime,
      shareConfig: { singleton: true, requiredVersion: "^19.0.0" },
    },
  },
});

export const loadNotificationsRemote =
  notificationsRuntime.loadRemote.bind(notificationsRuntime);
export const loadGlobalChromeRemote =
  globalChromeRuntime.loadRemote.bind(globalChromeRuntime);
