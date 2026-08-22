import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { FormattedMessage } from "react-intl";
import { apiClient } from "../lib/api";
import { DockerApp } from "../lib/types";
import { toast } from "sonner";
import { MetricCard } from "../components/MetricCard";
import { SystemOverview } from "../components/SystemOverview";
import { ResourceDistribution } from "../components/ResourceDistribution";
import { LiveLogs } from "../components/LiveLogs";
import { AppCard } from "../components/AppCard";

const workflowCards = [
  {
    label: "Observe",
    value: "Live telemetry",
    detail: "Containers, hosts, billing, and incidents stay visible.",
  },
  {
    label: "Plan",
    value: "Policy engine",
    detail: "Guardrails turn signals into repeatable infrastructure actions.",
  },
  {
    label: "Act",
    value: "One-click deploy",
    detail: "Rollouts, backups, and remediation keep moving with approvals.",
  },
];

export const Dashboard = () => {
  const navigate = useNavigate();
  const [apps, setApps] = useState<DockerApp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const appsData = await apiClient.listApps();
      setApps(appsData);
    } catch (error) {
      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateApp = () => {
    navigate("/apps/new");
  };

  const runningApps = apps.filter((a) => a.status === "running").length;
  const stoppedApps = apps.filter((a) => a.status === "stopped").length;
  const errorApps = apps.filter((a) => a.status === "error").length;
  const uptime = 99.98;

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-black/45 px-6 py-10 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:px-10 lg:px-14 lg:py-14">
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.22),transparent_23rem)]" />
        <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle,rgba(255,255,255,0.5)_1px,transparent_1.4px)] [background-size:13px_13px] [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_78%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center text-center">
          <div className="mb-8 flex h-28 w-28 items-center justify-center rounded-[2rem] bg-white p-3 shadow-[0_40px_100px_rgba(0,0,0,0.55)] ring-1 ring-white/50 sm:h-36 sm:w-36 sm:rounded-[2.4rem]">
            <div className="liquid-mark h-full w-full rounded-[1.6rem]" />
          </div>

          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2 text-sm text-white/70 shadow-lg shadow-black/20">
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
            Autonomous infrastructure control center
          </div>

          <h1 className="hero-title max-w-5xl text-6xl font-semibold text-white sm:text-7xl lg:text-8xl">
            The self-driving infra cockpit
          </h1>
          <p className="mt-7 max-w-3xl text-xl leading-8 text-white/70 sm:text-2xl sm:leading-9">
            Infra Pilot keeps deployments, monitoring, and remediation moving
            without constant prompts.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <button
              onClick={handleCreateApp}
              className="rounded-full bg-white px-8 py-4 text-base font-semibold text-black shadow-2xl shadow-white/10 transition-transform hover:-translate-y-0.5 hover:bg-slate-100"
            >
              Launch new app
            </button>
            <button
              onClick={() => navigate("/monitoring")}
              className="rounded-full border border-white/15 bg-white/[0.06] px-8 py-4 text-base font-semibold text-white backdrop-blur-xl transition-colors hover:bg-white/[0.1]"
            >
              Open mission control
            </button>
          </div>

          <div className="mt-12 grid w-full gap-4 md:grid-cols-3">
            {workflowCards.map((card) => (
              <div
                key={card.label}
                className="glass-panel rounded-[1.75rem] p-5 text-left"
              >
                <p className="text-sm uppercase tracking-[0.26em] text-white/35">
                  {card.label}
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {card.value}
                </p>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  {card.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-orbit pointer-events-none absolute right-[8%] top-24 hidden h-12 w-12 rounded-xl bg-blue-500/80 shadow-[0_0_45px_rgba(59,130,246,0.75)] ring-1 ring-white/30 lg:block [clip-path:polygon(50%_0,100%_100%,50%_75%,0_100%)]" />
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/35">
              Telemetry
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Key Metrics
            </h2>
          </div>
          <p className="hidden max-w-md text-right text-sm text-white/45 sm:block">
            A polished operational overview for the current production
            workspace.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          <MetricCard
            icon="📊"
            label="Total Apps"
            value={apps.length}
            change={{ value: 12, type: "up", timeframe: "last 7d" }}
            trend="up"
            accentColor="blue"
          />
          <MetricCard
            icon="▶️"
            label="Running Containers"
            value={runningApps}
            change={{ value: 8, type: "up", timeframe: "last 7d" }}
            trend="up"
            accentColor="green"
          />
          <MetricCard
            icon="⏹️"
            label="Stopped Containers"
            value={stoppedApps}
            change={{ value: 4, type: "down", timeframe: "last 7d" }}
            trend="stable"
            accentColor="red"
          />
          <MetricCard
            icon="⚠️"
            label="Errors"
            value={errorApps}
            change={{ value: 50, type: "down", timeframe: "last 7d" }}
            trend="down"
            accentColor="orange"
          />
          <MetricCard
            icon="✓"
            label="Uptime"
            value={`${uptime}%`}
            change={{ value: 0.01, type: "neutral", timeframe: "last 7d" }}
            trend="up"
            accentColor="cyan"
          />
          <MetricCard
            icon="👥"
            label="Active Customers"
            value={128}
            change={{ value: 15, type: "up", timeframe: "last 7d" }}
            trend="up"
            accentColor="purple"
          />
        </div>
      </section>

      {!loading && (
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-white/35">
                Fleet
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                <FormattedMessage id="dashboard.title" />
              </h2>
            </div>
            <button className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white">
              View all
            </button>
          </div>

          {apps.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-black/20 p-12 text-center">
              <p className="mb-4 text-white/55">No applications yet</p>
              <button
                onClick={handleCreateApp}
                className="inline-block rounded-full bg-white px-6 py-3 font-semibold text-black transition-transform hover:-translate-y-0.5 hover:bg-slate-100"
              >
                Create Your First App
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {apps.map((app) => (
                <AppCard
                  key={app.id}
                  id={app.id}
                  name={app.name}
                  image={app.image}
                  status={app.status}
                  cpu={Math.floor(Math.random() * 50) + 5}
                  memory={Math.floor(Math.random() * 512) + 128}
                  uptime="3d 14h"
                  ports={app.ports}
                  onClick={() => navigate(`/apps/${app.id}`)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SystemOverview />
        </div>
        <div>
          <ResourceDistribution />
        </div>
      </section>

      <LiveLogs />
    </div>
  );
};
