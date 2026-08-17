"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Search, Settings2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { ModelOption, ModelRef } from "@/app/types";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
import { usePlatform } from "@/react-app/kernel/platform";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import {
  getOpenWorkModelsActionUrl,
  hasOpenWorkModelsProvider,
  hideOpenWorkModelsPromo,
  isOpenWorkModelsPromoHidden,
  OPENWORK_MODEL_PREVIEWS,
  OPENWORK_MODELS_PROVIDER_ID,
  OPENWORK_MODELS_PROVIDER_NAME,
  openWorkModelsPromoChangedEvent,
} from "@/react-app/domains/cloud/openwork-models-promo";
import { ensureProviderListQuery, getConnectedProviderItems } from "@/react-app/infra/provider-list-query";
import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import { openModelPickerEvent } from "@/react-app/shell/new-providers-listener";
import { newProvidersEvent } from "@/app/lib/provider-events";
import { useShellConfig } from "@/react-app/shell/shell-config";
import {
  isWodeAppModelProvider,
  isWodeAppLegacyModelId,
  normalizeWodeAppModelRef,
  wodeAppCatalogOptionForModel,
  wodeAppModelSubtitle,
  wodeAppModelPriority,
  WODEAPP_OPEN_LOCAL_KEY_EVENT,
  groupModelsForPicker,
  isModelPickerVendorConfigured,
  modelPickerVendorLabel,
  modelPickerVendorId,
  withLocalPickerVendorPlaceholders,
  type ModelPickerConfigSource,
} from "@/react-app/domains/wodeapp/wodeapp-model-display";
import {
  modelCapabilityLabels,
  modelCapabilitySearchText,
  withInferredModelCapabilities,
} from "@/react-app/domains/wodeapp/wodeapp-model-capabilities";
import { useWodeAppAuthSession } from "@/react-app/domains/wodeapp/use-wodeapp-auth-session";
import {
  readCachedProviderCapabilitySnapshot,
  WODEAPP_PROVIDER_CAPABILITY_EVENT,
  type ProviderCapabilitySnapshot,
} from "@/react-app/domains/wodeapp/wodeapp-provider-capability";
import { refreshWodeAppProviderCapabilities } from "@/react-app/domains/wodeapp/wodeapp-provider-capability-panel";
import {
  buildPickerFamiliesFromSources,
  pickerFamilyMatchesRef,
  pickerTitleForModelRef,
  type PickerFamilyOption,
} from "@/react-app/domains/wodeapp/wodeapp-model-picker-families";

function useModelOptions(open: boolean) {
  const { client, opencodeBaseUrl, selectedWorkspaceRoot, providerList } = useWorkspace();
  const queryClient = useQueryClient();
  const checkDesktopRestriction = useCheckDesktopRestriction();

  React.useEffect(() => {
    if (!open || !client) return;
    void ensureProviderListQuery(queryClient, {
      client,
      baseUrl: opencodeBaseUrl,
      directory: selectedWorkspaceRoot,
      force: true,
    });
  }, [client, open, opencodeBaseUrl, queryClient, selectedWorkspaceRoot]);

  React.useEffect(() => {
    if (!client) return;
    const handler = () => {
      void ensureProviderListQuery(queryClient, {
        client,
        baseUrl: opencodeBaseUrl,
        directory: selectedWorkspaceRoot,
        force: true,
      });
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [client, opencodeBaseUrl, queryClient, selectedWorkspaceRoot]);

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` hides providers that OpenCode does not report
  //     as connected through the provider list endpoint.
  return React.useMemo(() => {
    const restrictToCloud = checkDesktopRestriction({
      restriction: "allowCustomProviders",
    });

    const options = getConnectedProviderItems(providerList)
      .flatMap((provider) =>
        Object.entries(provider.models).map(([id, model]) => withInferredModelCapabilities({
          providerID: provider.id,
          modelID: id,
          title: model.name,
          description:
            isWodeAppModelProvider(provider.id)
              ? wodeAppModelSubtitle(id)
              : provider.name,
          behaviorTitle: "Reasoning",
          behaviorLabel: "Default",
          behaviorDescription: "",
          behaviorValue: null,
          isFree: false,
          isConnected: true,
        })),
      );

    return options.filter((option) => {
      if (
        isDesktopProviderBlocked({
          providerId: option.providerID,
          checkRestriction: checkDesktopRestriction,
        })
      ) {
        return false;
      }

      if (restrictToCloud && !option.isConnected) {
        return false;
      }

      return true;
    });
  }, [checkDesktopRestriction, providerList]);
}

type ModelSelectModelItem = {
  kind: "model";
  id: string;
  option: ModelOption;
};

type ModelSelectOpenWorkItem = {
  kind: "openwork";
  id: string;
  title: string;
  subtitle: string;
};

function compareModelItems(a: ModelSelectModelItem, b: ModelSelectModelItem): number {
  const aLocal = !isWodeAppModelProvider(a.option.providerID);
  const bLocal = !isWodeAppModelProvider(b.option.providerID);
  if (aLocal !== bLocal) return aLocal ? -1 : 1;
  if (!aLocal && !bLocal) {
    const byPriority = wodeAppModelPriority(a.option.modelID) - wodeAppModelPriority(b.option.modelID);
    if (byPriority !== 0) return byPriority;
  }
  return a.option.title.localeCompare(b.option.title);
}

export function normalizeWodeAppModelOption(option: ModelOption): ModelOption {
  if (!isWodeAppModelProvider(option.providerID)) return option;

  const catalogOption = wodeAppCatalogOptionForModel(option.modelID);
  if (!catalogOption) return option;

  return {
    ...option,
    modelID: isWodeAppLegacyModelId(option.modelID) ? option.modelID : catalogOption.modelID,
    title: catalogOption.title,
    description: catalogOption.description,
    capabilities: withInferredModelCapabilities({
      ...option,
      modelID: catalogOption.modelID,
      title: catalogOption.title,
      description: catalogOption.description,
    }).capabilities,
  };
}

export function modelRefForOption(option: ModelOption): ModelRef {
  const normalizedOption = normalizeWodeAppModelOption(option);
  return normalizeWodeAppModelRef({
    providerID: normalizedOption.providerID,
    modelID: normalizedOption.modelID,
  });
}

function familyToModelOption(family: PickerFamilyOption): ModelOption {
  return withInferredModelCapabilities({
    providerID: family.providerID,
    modelID: family.modelID,
    title: family.title,
    description: "",
    behaviorTitle: "Reasoning",
    behaviorLabel: "Default",
    behaviorDescription: "",
    behaviorValue: null,
    isFree: false,
    isConnected: true,
  });
}

function pickerSourcesFromOptions(
  modelOptions: ModelOption[],
  capabilitySources: ModelPickerConfigSource[],
) {
  const byProvider = new Map<string, string[]>();
  for (const option of modelOptions) {
    const list = byProvider.get(option.providerID) || [];
    list.push(option.modelID);
    byProvider.set(option.providerID, list);
  }
  for (const source of capabilitySources) {
    const id = String(source.id || "").trim();
    if (!id) continue;
    const extra = Array.isArray(source.modelIds) ? source.modelIds : [];
    const list = byProvider.get(id) || [];
    list.push(...extra.map((item) => String(item || "").trim()).filter(Boolean));
    byProvider.set(id, list);
  }
  return [...byProvider.entries()].map(([id, modelIds]) => ({
    id,
    modelIds: [...new Set(modelIds)],
  }));
}

function collapseToFamilyOptions(
  modelOptions: ModelOption[],
  capabilitySources: ModelPickerConfigSource[],
): ModelOption[] {
  const families = buildPickerFamiliesFromSources(
    pickerSourcesFromOptions(modelOptions, capabilitySources),
  );
  return families.map(familyToModelOption);
}

function groupByVendor(modelOptions: ModelOption[], includePlaceholders: boolean) {
  const grouped = groupModelsForPicker(modelOptions).map((vendor) => ({
    ...vendor,
    items: [...vendor.items]
      .map((option) => ({
        kind: "model" as const,
        id: `${option.providerID}:${option.modelID}`,
        option,
      }))
      .sort(compareModelItems),
  }));
  return includePlaceholders ? withLocalPickerVendorPlaceholders(grouped) : grouped;
}

function openWorkModelsGroup(): { value: string; promo: true; items: ModelSelectOpenWorkItem[] } {
  return {
    value: OPENWORK_MODELS_PROVIDER_NAME,
    promo: true,
    items: OPENWORK_MODEL_PREVIEWS.map((model) => ({
      kind: "openwork",
      id: model.id,
      title: model.title,
      subtitle: model.subtitle,
    })),
  };
}

function isSameModel(a: ModelRef, b: ModelRef) {
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

function searchModelOptions(modelOptions: ModelOption[], search: string): ModelOption[] {
  const query = search.trim().toLowerCase();
  if (!query) return modelOptions;

  return modelOptions.filter((option) =>
    [
      option.title,
      option.description,
      option.providerID,
      option.modelID,
      modelPickerVendorLabel(modelPickerVendorId(option.providerID, option.modelID)),
      modelCapabilitySearchText(option.capabilities),
    ].some((value) => value?.toLowerCase().includes(query)),
  );
}

interface ModelSelectProps {
  open: boolean;
  value: ModelRef;
  onOpenChange: (open: boolean) => void;
  onChange: (model: ModelRef) => void;
  disabled?: boolean;
}

export function ModelSelect({
  open,
  value,
  onOpenChange,
  onChange,
  disabled = false,
}: ModelSelectProps) {
  const [search, setSearch] = React.useState("");
  const [promoHidden, setPromoHidden] = React.useState(isOpenWorkModelsPromoHidden);
  const [capabilitySources, setCapabilitySources] = React.useState<ModelPickerConfigSource[]>(
    () => readCachedProviderCapabilitySnapshot()?.sources ?? [],
  );
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const modelOptions = useModelOptions(open);
  const denAuth = useDenAuth();
  const navigate = useNavigate();
  const platform = usePlatform();
  const { signedIn: wodeAppSignedIn, authConfig } = useWodeAppAuthSession();
  const cloudSignedIn = Boolean(wodeAppSignedIn) && !authConfig?.embedded;
  const { config: shellConfig } = useShellConfig();
  const visibleModelOptions = React.useMemo(() => {
    const filteredOptions = shellConfig.wodeappWorkbench
      ? modelOptions.filter((option) => option.providerID !== OPENWORK_MODELS_PROVIDER_ID)
      : modelOptions;

    return shellConfig.wodeappWorkbench
      ? collapseToFamilyOptions(filteredOptions, capabilitySources)
      : filteredOptions;
  }, [capabilitySources, modelOptions, shellConfig.wodeappWorkbench]);

  React.useEffect(() => {
    const handlePromoChanged = () => setPromoHidden(isOpenWorkModelsPromoHidden());
    window.addEventListener(openWorkModelsPromoChangedEvent, handlePromoChanged);
    return () => window.removeEventListener(openWorkModelsPromoChangedEvent, handlePromoChanged);
  }, []);

  React.useEffect(() => {
    const onCapability = (event: Event) => {
      const detail = (event as CustomEvent<ProviderCapabilitySnapshot>).detail;
      setCapabilitySources(detail?.sources ?? []);
    };
    window.addEventListener(WODEAPP_PROVIDER_CAPABILITY_EVENT, onCapability);
    setCapabilitySources(readCachedProviderCapabilitySnapshot()?.sources ?? []);
    return () => window.removeEventListener(WODEAPP_PROVIDER_CAPABILITY_EVENT, onCapability);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void refreshWodeAppProviderCapabilities();
  }, [open]);

  const focusSearchInput = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;

      if (!input) {
        return;
      }

      input.focus();
      input.select();
    });
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    focusSearchInput();
  }, [focusSearchInput, open]);

  const selectedModelRef = React.useMemo(() => normalizeWodeAppModelRef(value), [value]);
  const selectedOption = visibleModelOptions.find((option) =>
    pickerFamilyMatchesRef({
      familyId: modelPickerVendorId(option.providerID, option.modelID),
      providerID: option.providerID,
      modelID: option.modelID,
    }, selectedModelRef)
    || isSameModel(selectedModelRef, modelRefForOption(option)),
  );
  const selectedTitle = selectedOption?.title
    ?? pickerTitleForModelRef(selectedModelRef, visibleModelOptions.map((option) => ({
      familyId: modelPickerVendorId(option.providerID, option.modelID),
      variantKey: option.modelID,
      title: option.title,
      providerID: option.providerID,
      modelID: option.modelID,
    })))
    ?? selectedModelRef.modelID
    ?? "Select model";

  const showOpenWorkModelsPromo = React.useMemo(
    () => !shellConfig.wodeappWorkbench
      && !promoHidden
      && !hasOpenWorkModelsProvider(visibleModelOptions.map((option) => option.providerID)),
    [promoHidden, shellConfig.wodeappWorkbench, visibleModelOptions],
  );

  const filteredModelOptions = React.useMemo(
    () => searchModelOptions(visibleModelOptions, search),
    [search, visibleModelOptions],
  );

  const vendorGroups = React.useMemo(
    () => groupByVendor(filteredModelOptions, !search.trim()),
    [filteredModelOptions, search],
  );

  const handleSelect = React.useCallback((option: ModelOption) => {
    onChange(modelRefForOption(option));
    setSearch("");
    onOpenChange(false);
  }, [onChange, onOpenChange]);

  const handleConfigureVendor = React.useCallback(() => {
    onOpenChange(false);
    setSearch("");
    window.dispatchEvent(new Event(WODEAPP_OPEN_LOCAL_KEY_EVENT));
  }, [onOpenChange]);

  const handleOpenWorkModels = React.useCallback(() => {
    onOpenChange(false);
    setSearch("");
    if (!denAuth.isSignedIn) {
      navigate("/settings/cloud-account");
    }
    window.setTimeout(() => {
      platform.openLink(getOpenWorkModelsActionUrl(denAuth.isSignedIn));
    }, 0);
  }, [denAuth.isSignedIn, navigate, onOpenChange, platform]);

  const handleHideOpenWorkModels = React.useCallback(() => {
    hideOpenWorkModelsPromo();
    setPromoHidden(true);
  }, []);

  const handlePopoverOpenChange = React.useCallback((nextOpen: boolean) => {
    // Base UI can reconcile a controlled popover while ModelSelect is still
    // rendering. Defer parent/local state updates until the current render
    // stack has completed to avoid React's cross-component render warning.
    window.queueMicrotask(() => {
      onOpenChange(nextOpen);
      if (!nextOpen) setSearch("");
    });
  }, [onOpenChange]);

  return (
    <Popover
      open={open}
      onOpenChange={handlePopoverOpenChange}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              type="button"
              disabled={disabled}
              aria-label="选择模型"
              aria-keyshortcuts="Meta+Alt+/"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12 disabled:pointer-events-none disabled:opacity-60"
            />
          }
        >
          <span className="max-w-48 truncate">
            {selectedTitle}
          </span>
          <ChevronDown className="h-3 w-3" />
        </TooltipTrigger>
        <TooltipContent>
          选择模型
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="h-80 max-h-(--available-height) w-80 gap-0 overflow-hidden p-px **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-0.5"
        align="start"
        initialFocus={false}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="relative border-b border-border px-3 py-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="搜索模型"
              className="h-9 w-full rounded-md bg-transparent pl-8 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {showOpenWorkModelsPromo ? (
              <div className="mb-2">
                <div className="mb-1 flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-foreground">
                  <Sparkles className="size-3 text-blue-11" />
                  <span className="min-w-0 truncate">{openWorkModelsGroup().value}</span>
                </div>
                <div className="space-y-1">
                  {openWorkModelsGroup().items.map((item) => (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md border border-blue-6/50 bg-blue-2/40 px-2 py-2 text-left text-sm transition-colors hover:bg-blue-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      key={item.id}
                      onClick={handleOpenWorkModels}
                    >
                      <ProviderIcon
                        providerId={OPENWORK_MODELS_PROVIDER_ID}
                        providerName={OPENWORK_MODELS_PROVIDER_NAME}
                        className="size-3.5 text-blue-11"
                        size={14}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">
                          {item.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </span>
                      </span>
                      <ChevronRight className="size-3.5 text-blue-11" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {vendorGroups.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                没有匹配的模型
              </div>
            ) : (
              vendorGroups.map((vendor) => {
                const configured = isModelPickerVendorConfigured(
                  vendor.vendorId,
                  capabilitySources,
                  cloudSignedIn,
                );
                return (
                <div key={vendor.vendorId} className="mb-2 last:mb-0">
                  <div className="mb-1 flex max-w-full items-center gap-2 px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                      {vendor.vendorLabel}
                    </span>
                    {configured ? (
                      <span className="inline-flex min-w-0 shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                        <Check className="size-3" aria-hidden />
                        已配置
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 shrink-0 rounded px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        onClick={handleConfigureVendor}
                      >
                        去配置
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {vendor.items.map((item) => {
                      const option = item.option;
                      const checked = pickerFamilyMatchesRef({
                        familyId: modelPickerVendorId(option.providerID, option.modelID),
                        providerID: option.providerID,
                        modelID: option.modelID,
                      }, selectedModelRef)
                        || isSameModel(selectedModelRef, modelRefForOption(option));
                      const capabilityLabels = modelCapabilityLabels(option.capabilities);
                      return (
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${checked ? "bg-accent text-accent-foreground" : ""}`}
                          key={item.id}
                          aria-pressed={checked}
                          onClick={() => handleSelect(option)}
                        >
                          <ProviderIcon
                            providerId={option.providerID}
                            providerName={vendor.vendorLabel}
                            className="size-3.5 opacity-70"
                            size={14}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-foreground">
                              {option.title}
                            </span>
                            {capabilityLabels.length > 0 ? (
                              <span className="mt-1 flex max-w-full flex-wrap gap-1">
                                {capabilityLabels.map((label) => (
                                  <span
                                    key={label}
                                    className="rounded border border-border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
                                  >
                                    {label}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                );
              })
            )}
          </div>
          {!shellConfig.wodeappWorkbench ? (
          <div className="border-t border-border px-2 py-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onOpenChange(false);
                  setSearch("");
                  window.dispatchEvent(new CustomEvent(openModelPickerEvent));
                }}
              >
                <Settings2 className="size-3.5" />
                All models
              </button>
              {showOpenWorkModelsPromo ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={handleHideOpenWorkModels}
                >
                Hide
              </button>
              ) : null}
            </div>
          </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

