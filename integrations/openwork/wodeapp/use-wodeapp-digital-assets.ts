import * as React from "react";

import { getWodeAppApiCredentials } from "@/app/lib/wodeapp-auth";

import { fetchWodeAppDigitalAssets } from "./digital-assets-api";
import { digitalAssetToMention } from "./digital-assets-data";
import {
  getDigitalAssetsList,
  resetDigitalAssetsList,
  setDigitalAssetsList,
  setDigitalAssetsSignedIn,
} from "./digital-assets-store";
import { rememberAssetMention } from "./wodeapp-workbench-context";

function rememberLoadedDigitalAssets() {
  for (const asset of getDigitalAssetsList()) {
    rememberAssetMention(digitalAssetToMention(asset));
  }
}

export function useWodeAppDigitalAssets() {
  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const credentials = await getWodeAppApiCredentials();
      if (cancelled) return;

      setDigitalAssetsSignedIn(Boolean(credentials));

      if (!credentials) {
        resetDigitalAssetsList();
        rememberLoadedDigitalAssets();
        return;
      }

      try {
        const assets = await fetchWodeAppDigitalAssets(credentials);
        if (cancelled) return;
        setDigitalAssetsList(assets);
        rememberLoadedDigitalAssets();
      } catch (error) {
        console.warn("[WodeAppX] Failed to load WodeApp digital assets", error);
        if (!cancelled) {
          resetDigitalAssetsList();
          rememberLoadedDigitalAssets();
        }
      }
    };

    void load();
    const onAuthChange = () => void load();
    window.addEventListener("wodeapp:auth-changed", onAuthChange);
    return () => {
      cancelled = true;
      window.removeEventListener("wodeapp:auth-changed", onAuthChange);
    };
  }, []);
}
