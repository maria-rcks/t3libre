import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadGroupId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const seedReadModel = Effect.gen(function* () {
  const now = "2026-01-01T00:00:00.000Z";
  const initial = createEmptyReadModel(now);
  const withProject = yield* projectEvent(initial, {
    sequence: 1,
    eventId: asEventId("evt-project-create"),
    aggregateKind: "project",
    aggregateId: asProjectId("project-delete"),
    type: "project.created",
    occurredAt: now,
    commandId: asCommandId("cmd-project-create"),
    causationEventId: null,
    correlationId: asCommandId("cmd-project-create"),
    metadata: {},
    payload: {
      projectId: asProjectId("project-delete"),
      title: "Project Delete",
      workspaceRoot: "/tmp/project-delete",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });

  const withFirstThread = yield* projectEvent(withProject, {
    sequence: 2,
    eventId: asEventId("evt-thread-create-1"),
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-delete-1"),
    type: "thread.created",
    occurredAt: now,
    commandId: asCommandId("cmd-thread-create-1"),
    causationEventId: null,
    correlationId: asCommandId("cmd-thread-create-1"),
    metadata: {},
    payload: {
      threadId: asThreadId("thread-delete-1"),
      projectId: asProjectId("project-delete"),
      title: "Thread Delete 1",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  return yield* projectEvent(withFirstThread, {
    sequence: 3,
    eventId: asEventId("evt-thread-create-2"),
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-delete-2"),
    type: "thread.created",
    occurredAt: now,
    commandId: asCommandId("cmd-thread-create-2"),
    causationEventId: null,
    correlationId: asCommandId("cmd-thread-create-2"),
    metadata: {},
    payload: {
      threadId: asThreadId("thread-delete-2"),
      projectId: asProjectId("project-delete"),
      title: "Thread Delete 2",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });
});

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function normalizeDeleteEvent(event: PlannedEvent | ReadonlyArray<PlannedEvent>) {
  const events = Array.isArray(event) ? event : [event];
  return events.map((entry) => {
    switch (entry.type) {
      case "thread.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            threadId: entry.payload.threadId,
          },
        };
      case "project.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            projectId: entry.payload.projectId,
          },
        };
      default:
        return entry;
    }
  });
}

const seedGroupedReadModel = Effect.gen(function* () {
  const now = "2026-01-01T00:00:00.000Z";
  const seeded = yield* seedReadModel;
  const withGroup = yield* projectEvent(seeded, {
    sequence: 4,
    eventId: asEventId("evt-group-create"),
    aggregateKind: "thread-group",
    aggregateId: ThreadGroupId.make("group-1"),
    type: "thread-group.created",
    occurredAt: now,
    commandId: asCommandId("cmd-group-create"),
    causationEventId: null,
    correlationId: asCommandId("cmd-group-create"),
    metadata: {},
    payload: {
      groupId: ThreadGroupId.make("group-1"),
      projectId: asProjectId("project-delete"),
      name: "Group",
      icon: null,
      nameGeneration: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  return yield* projectEvent(withGroup, {
    sequence: 5,
    eventId: asEventId("evt-group-set"),
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-delete-1"),
    type: "thread.group-set",
    occurredAt: now,
    commandId: asCommandId("cmd-group-create"),
    causationEventId: null,
    correlationId: asCommandId("cmd-group-create"),
    metadata: {},
    payload: {
      threadId: asThreadId("thread-delete-1"),
      groupId: ThreadGroupId.make("group-1"),
      updatedAt: now,
    },
  });
});

it.layer(NodeServices.layer)("decider thread group flows", (it) => {
  it.effect("deleting a group's last member retires the group", () =>
    Effect.gen(function* () {
      const readModel = yield* seedGroupedReadModel;
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.delete",
          commandId: asCommandId("cmd-thread-delete-grouped"),
          threadId: asThreadId("thread-delete-1"),
        },
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.deleted", "thread-group.deleted"]);
      expect(events[1]?.aggregateId).toBe("group-1");
    }),
  );

  it.effect(
    "moving the last member out retires the group; re-setting the same group is a no-op",
    () =>
      Effect.gen(function* () {
        const readModel = yield* seedGroupedReadModel;
        const moved = yield* decideOrchestrationCommand({
          command: {
            type: "thread.group.set",
            commandId: asCommandId("cmd-group-unset"),
            threadId: asThreadId("thread-delete-1"),
            groupId: null,
          },
          readModel,
        });
        const movedEvents = Array.isArray(moved) ? moved : [moved];
        expect(movedEvents.map((event) => event.type)).toEqual([
          "thread.group-set",
          "thread-group.deleted",
        ]);

        const same = yield* decideOrchestrationCommand({
          command: {
            type: "thread.group.set",
            commandId: asCommandId("cmd-group-same"),
            threadId: asThreadId("thread-delete-1"),
            groupId: ThreadGroupId.make("group-1"),
          },
          readModel,
        });
        const sameEvents = Array.isArray(same) ? same : [same];
        expect(sameEvents.map((event) => event.type)).toEqual(["thread.group-set"]);
        if (sameEvents[0]?.type === "thread.group-set") {
          expect(sameEvents[0].payload.updatedAt).toBe(readModel.threads[0]?.updatedAt);
        }
      }),
  );

  it.effect("grouping and moving reject a soft-deleted thread", () =>
    Effect.gen(function* () {
      const readModel = yield* seedGroupedReadModel;
      const deletedAt = "2026-01-01T00:00:01.000Z";
      const withDeleted = {
        ...readModel,
        threads: readModel.threads.map((thread) =>
          thread.id === "thread-delete-2" ? { ...thread, deletedAt } : thread,
        ),
      };
      const createError = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "thread-group.create",
            commandId: asCommandId("cmd-group-create-deleted"),
            groupId: ThreadGroupId.make("group-3"),
            projectId: asProjectId("project-delete"),
            threadIds: [asThreadId("thread-delete-2")],
            createdAt: deletedAt,
          },
          readModel: withDeleted,
        }),
      );
      expect(createError.message).toContain("is deleted");
      const setError = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "thread.group.set",
            commandId: asCommandId("cmd-group-set-deleted"),
            threadId: asThreadId("thread-delete-2"),
            groupId: ThreadGroupId.make("group-1"),
          },
          readModel: withDeleted,
        }),
      );
      expect(setError.message).toContain("is deleted");
    }),
  );

  it.effect("creating a group rejects members from another project", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "thread-group.create",
            commandId: asCommandId("cmd-group-create-cross"),
            groupId: ThreadGroupId.make("group-2"),
            projectId: asProjectId("project-delete"),
            threadIds: [asThreadId("thread-delete-2")],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          readModel: {
            ...readModel,
            threads: readModel.threads.map((thread) =>
              thread.id === "thread-delete-2"
                ? { ...thread, projectId: asProjectId("project-other") }
                : thread,
            ),
          },
        }),
      );
      expect(error.message).toContain("belongs to another project");
    }),
  );

  it.effect("a late name completion for a superseded request only clears nothing", () =>
    Effect.gen(function* () {
      const readModel = yield* seedGroupedReadModel;
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread-group.name.generate.complete",
          commandId: asCommandId("cmd-group-name-complete"),
          groupId: ThreadGroupId.make("group-1"),
          requestId: asCommandId("cmd-stale-request"),
          name: "Stale name",
        },
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.type).toBe("thread-group.meta-updated");
      if (events[0]?.type === "thread-group.meta-updated") {
        expect(events[0].payload.name).toBeUndefined();
        expect(events[0].payload.nameGeneration).toBeUndefined();
      }
    }),
  );
});

it.layer(NodeServices.layer)("decider deletion flows", (it) => {
  it.effect("rejects deleting a non-empty project without force", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "project.delete",
            commandId: asCommandId("cmd-project-delete-no-force"),
            projectId: asProjectId("project-delete"),
          },
          readModel,
        }),
      );
      expect(error.message).toContain("cannot be deleted without force=true");
    }),
  );

  it.effect("reuses thread.delete semantics when force-deleting a non-empty project", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const projectDeleteCommand: Extract<OrchestrationCommand, { type: "project.delete" }> = {
        type: "project.delete",
        commandId: asCommandId("cmd-project-delete-force"),
        projectId: asProjectId("project-delete"),
        force: true,
      };

      const forcedResult = yield* decideOrchestrationCommand({
        command: projectDeleteCommand,
        readModel,
      });
      const forcedEvents = Array.isArray(forcedResult) ? forcedResult : [forcedResult];

      expect(forcedEvents.map((event) => event.type)).toEqual([
        "thread.deleted",
        "thread.deleted",
        "project.deleted",
      ]);

      let sequentialReadModel = readModel;
      let nextSequence = readModel.snapshotSequence;
      const sequentialEvents: PlannedEvent[] = [];
      for (const nextCommand of [
        {
          type: "thread.delete",
          commandId: projectDeleteCommand.commandId,
          threadId: asThreadId("thread-delete-1"),
        },
        {
          type: "thread.delete",
          commandId: projectDeleteCommand.commandId,
          threadId: asThreadId("thread-delete-2"),
        },
        {
          type: "project.delete",
          commandId: projectDeleteCommand.commandId,
          projectId: asProjectId("project-delete"),
        },
      ] satisfies ReadonlyArray<OrchestrationCommand>) {
        const decided = yield* decideOrchestrationCommand({
          command: nextCommand,
          readModel: sequentialReadModel,
        });
        const nextEvents = Array.isArray(decided) ? decided : [decided];
        sequentialEvents.push(...nextEvents);
        for (const nextEvent of nextEvents) {
          nextSequence += 1;
          sequentialReadModel = yield* projectEvent(sequentialReadModel, {
            ...nextEvent,
            sequence: nextSequence,
          });
        }
      }

      expect(normalizeDeleteEvent(forcedResult)).toEqual(normalizeDeleteEvent(sequentialEvents));
    }),
  );
});
