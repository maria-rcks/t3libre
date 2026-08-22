import { useNavigate, useLocation } from "react-router";
import { useState } from "react";
import { useIntl } from "react-intl";
import { useConfig } from "../lib/types";
import { LanguageSelector } from "../i18n/LanguageSelector";

interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  route?: string;
  children?: SidebarItem[];
  attrs?: Record<string, string>;
}

const SimpleLogo = ({ size = 32 }: { size?: number }) => (
  <div
    className="liquid-mark rounded-[0.85rem] flex items-center justify-center text-transparent font-bold ring-1 ring-white/30"
    style={{ width: size, height: size, fontSize: size * 0.4 }}
  >
    IP
  </div>
);

export const Sidebar = ({
  isMobileOpen,
  onMobileClose,
}: {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode } = useConfig();
  const intl = useIntl();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const sidebarItems: SidebarItem[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "📊",
      route: "/dashboard",
    },
    {
      id: "bi-dashboard",
      label: "BI Dashboard",
      icon: "📈",
      route: "/bi-dashboard",
    },
    {
      id: "topology",
      label: "3D Topology",
      icon: "🌐",
      route: "/topology",
    },
    {
      id: "monitoring",
      label: "Monitoring",
      icon: "📈",
      route: "/monitoring",
      attrs: { "data-tour": "monitoring" },
    },
    {
      id: "apps",
      label: "Apps",
      icon: "📦",
      route: "/apps",
      attrs: { "data-tour": "apps" },
    },
    {
      id: "deployments",
      label: "Deployments",
      icon: "🚀",
      route: "/deployments",
    },
    {
      id: "logs",
      label: "Logs",
      icon: "📝",
      children: [
        { id: "live-logs", label: "Live Logs", icon: "📋", route: "/logs" },
        {
          id: "access-logs",
          label: "Access Logs",
          icon: "🔐",
          route: "/logs/access",
        },
      ],
    },
    ...(mode === "business"
      ? [
          {
            id: "customers",
            label: "Customers",
            icon: "👥",
            route: "/customers",
          },
          {
            id: "billing",
            label: "Billing",
            icon: "💳",
            route: "/billing",
          },
          {
            id: "cost-analytics",
            label: "Cost Analytics",
            icon: "💰",
            route: "/cost-analytics",
          },
          {
            id: "teams",
            label: "Teams",
            icon: "👨‍💼",
            route: "/teams",
          },
        ]
      : []),
    {
      id: "dependencies",
      label: "Dependencies",
      icon: "🔗",
      route: "/dependencies",
    },
    {
      id: "backups",
      label: "Backups",
      icon: "💾",
      route: "/backups",
      attrs: { "data-tour": "backups" },
    },
    {
      id: "reports",
      label: "Reports",
      icon: "📄",
      children: [
        {
          id: "report-viewer",
          label: "Report Viewer",
          icon: "📋",
          route: "/reports",
        },
        {
          id: "report-builder",
          label: "Report Builder",
          icon: "🛠️",
          route: "/reports/builder",
        },
      ],
    },
    {
      id: "theme-studio",
      label: "Theme Studio",
      icon: "🎨",
      route: "/theme-studio",
    },
    {
      id: "knowledge-base",
      label: "Knowledge Base",
      icon: "📚",
      route: "/knowledge-base",
    },
    {
      id: "activity",
      label: "Activity",
      icon: "📋",
      route: "/activity",
    },
    {
      id: "dashboard-builder",
      label: "Dashboards",
      icon: "📐",
      route: "/dashboard-builder",
    },
    {
      id: "marketplace",
      label: "Marketplace",
      icon: "🧩",
      route: "/marketplace",
    },
    {
      id: "geo-heatmap",
      label: "Geo Heatmap",
      icon: "🗺️",
      route: "/geo-heatmap",
    },
    {
      id: "settings",
      label: "Settings",
      icon: "⚙️",
      attrs: { "data-tour": "settings" },
      children: [
        { id: "general", label: "General", icon: "🔧", route: "/settings" },
        {
          id: "alerts",
          label: "Alerts",
          icon: "🔔",
          route: "/settings/alerts",
        },
        {
          id: "maintenance",
          label: "Maintenance",
          icon: "🛠️",
          route: "/settings/maintenance",
        },
      ],
    },
  ];

  const isActive = (route?: string) => {
    if (!route) return false;
    return location.pathname.startsWith(route);
  };

  const handleNavigation = (route?: string) => {
    if (route) {
      navigate(route);
      onMobileClose?.();
    }
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}
      <div
        className={`fixed md:sticky inset-y-0 left-0 z-30 w-64 h-screen border-r border-white/10 bg-black/55 backdrop-blur-2xl flex flex-col overflow-y-auto transition-transform duration-200 ${isMobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      >
        {/* Logo Section */}
        <div className="p-5 border-b border-white/10">
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => {
              navigate("/dashboard");
              onMobileClose?.();
            }}
          >
            <SimpleLogo size={40} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">
                Infra Pilot
              </h1>
              <p className="text-xs text-white/45">v2.4.1</p>
            </div>
          </div>
        </div>

        {/* Organization Selector */}
        <div className="p-4 border-b border-white/10">
          <button className="group w-full rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 text-left shadow-lg shadow-black/20 transition-colors hover:bg-white/[0.09]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white transition-colors group-hover:text-white">
                  Acme Corp
                </p>
                <p className="text-xs text-white/45">Production</p>
              </div>
              <span className="text-white/35">▼</span>
            </div>
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-1.5 p-4">
          {sidebarItems.map((item) => (
            <div key={item.id}>
              <button
                {...(item.attrs || {})}
                onClick={() => {
                  if (item.children) {
                    toggleExpanded(item.id);
                  } else {
                    handleNavigation(item.route);
                  }
                }}
                className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 transition-all ${
                  isActive(item.route)
                    ? "bg-white text-black shadow-xl shadow-white/10"
                    : "text-white/65 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm font-medium flex-1 text-left">
                  {item.label}
                </span>
                {item.children && (
                  <span
                    className={`transition-transform ${
                      expandedItems.includes(item.id) ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                )}
              </button>

              {/* Nested Items */}
              {item.children && expandedItems.includes(item.id) && (
                <div className="pl-4 space-y-1 mt-1">
                  {item.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => handleNavigation(child.route)}
                      className={`w-full flex items-center gap-2 rounded-2xl px-4 py-2 text-sm transition-colors ${
                        isActive(child.route)
                          ? "bg-white text-black shadow-xl shadow-white/10"
                          : "text-white/60 hover:bg-white/[0.08] hover:text-white"
                      }`}
                    >
                      <span>{child.icon}</span>
                      <span>{child.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Docker Host Status */}
        <div className="space-y-3 border-t border-white/10 p-4">
          <div className="glass-panel rounded-[1.35rem] px-3 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-white">
                Docker Host
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.9)]"></span>
                <span className="text-xs text-emerald-300">Healthy</span>
              </span>
            </div>
            <div className="space-y-1 text-xs text-white/65">
              <div className="flex justify-between">
                <span>CPU</span>
                <span className="font-semibold">23%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-emerald-400"
                  style={{ width: "23%" }}
                ></div>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-xs text-white/65">
              <div className="flex justify-between">
                <span>Memory</span>
                <span className="font-semibold">6.1 / 15.6 GB</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-sky-400"
                  style={{ width: "39%" }}
                ></div>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-xs text-white/65">
              <div className="flex justify-between">
                <span>Disk</span>
                <span className="font-semibold">112 / 250 GB</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-orange-300"
                  style={{ width: "45%" }}
                ></div>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-xs text-white/65">
              <div className="flex justify-between">
                <span>Uptime</span>
                <span className="font-semibold">15d 6h 24m</span>
              </div>
            </div>
          </div>
        </div>

        {/* Help & Documentation */}
        <div className="space-y-2 border-t border-white/10 p-4">
          <div className="px-2">
            <LanguageSelector />
          </div>
          <button className="flex w-full items-center gap-2 rounded-2xl px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white">
            <span>❓</span>
            <span>Need help?</span>
          </button>
          <button className="flex w-full items-center gap-2 rounded-2xl px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white">
            <span>📚</span>
            <span>Documentation</span>
          </button>
        </div>
      </div>
    </>
  );
};
