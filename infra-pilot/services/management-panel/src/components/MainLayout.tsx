import { Outlet, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { apiClient } from "../lib/api";
import { clearAccessToken } from "../lib/auth";
import { useConfig } from "../lib/types";
import { Sidebar } from "./Sidebar";
import { UserAvatar } from "./UserAvatar";
import DemoFlagBadge from "./DemoFlagBadge";
import { Announcements } from "./accessibility/Announcements";

export const MainLayout = () => {
  const navigate = useNavigate();
  const { mode } = useConfig();
  const [user, setUser] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const userData = await apiClient.getUser();
        setUser(userData);
      } catch (error) {
        console.error("Failed to load user");
      }
    };
    loadUser();
  }, []);

  const handleLogout = () => {
    clearAccessToken();
    apiClient.clearToken();
    navigate("/setup");
    window.location.reload();
  };

  return (
    <div className="ara-shell flex min-h-screen text-white">
      <Announcements />
      {/* Sidebar */}
      <Sidebar
        isMobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col ara-surface">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-white/10 bg-black/45 backdrop-blur-2xl">
          <div className="px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-6">
              {/* Organization Selector & Search */}
              <div className="flex items-center gap-4 flex-1">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden rounded-full border border-white/10 bg-white/5 p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Open sidebar"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>
                <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 shadow-lg shadow-black/20 transition-colors hover:bg-white/[0.1] sm:flex">
                  <span className="text-sm text-white">
                    Acme Corp / Production
                  </span>
                  <span className="text-white/45">▼</span>
                </div>
                <div className="flex-1 max-w-md">
                  <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 shadow-lg shadow-black/20 focus-within:border-white/25 focus-within:ring-1 focus-within:ring-white/20">
                    <span className="text-white/45">🔍</span>
                    <input
                      type="text"
                      placeholder="Search apps, containers, logs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                    />
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/35">
                      ⌘K
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Section */}
              <div className="flex items-center gap-4">
                {/* Notifications */}
                <button className="relative rounded-full border border-white/10 bg-white/[0.04] p-2 transition-colors hover:bg-white/[0.1]">
                  <span className="text-lg">🔔</span>
                  <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full"></span>
                </button>

                {/* System Status */}
                <button className="rounded-full border border-white/10 bg-white/[0.04] p-2 transition-colors hover:bg-white/[0.1]">
                  <span className="text-lg">📊</span>
                </button>

                {/* Settings */}
                <button className="rounded-full border border-white/10 bg-white/[0.04] p-2 transition-colors hover:bg-white/[0.1]">
                  <span className="text-lg">⚙️</span>
                </button>

                {/* User Profile */}
                {user && (
                  <div className="flex items-center gap-3 border-l border-white/10 pl-4">
                    <div className="text-right">
                      <p className="text-sm font-medium text-white">
                        {user.display_name || "John Doe"}
                      </p>
                      <p className="text-xs text-white/45">
                        {user.role || "Admin"}
                      </p>
                    </div>
                    <UserAvatar
                      value={user.id || user.email}
                      size={36}
                      className="rounded-full shadow-lg shadow-white/10"
                    />
                    <button
                      onClick={handleLogout}
                      className="ml-2 rounded-full border border-white/10 p-1 transition-colors hover:bg-white/10"
                      title="Logout"
                    >
                      <span className="text-sm text-white/45 hover:text-white">
                        ✕
                      </span>
                    </button>
                  </div>
                )}

                <DemoFlagBadge />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto" id="main-content">
          <div className="p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
