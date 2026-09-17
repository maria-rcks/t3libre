/**
 * ProjectionThreadGroupRepository - Projection repository interface for
 * thread groups (user-made sidebar folders of threads).
 *
 * @module ProjectionThreadGroupRepository
 */
import {
  CommandId,
  IsoDateTime,
  ProjectIconOverride,
  ProjectId,
  ThreadGroupId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadGroup = Schema.Struct({
  groupId: ThreadGroupId,
  projectId: ProjectId,
  name: Schema.String,
  icon: Schema.NullOr(ProjectIconOverride),
  nameGenerationRequestId: Schema.NullOr(CommandId),
  nameGenerationStartedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionThreadGroup = typeof ProjectionThreadGroup.Type;

export const GetProjectionThreadGroupInput = Schema.Struct({
  groupId: ThreadGroupId,
});
export type GetProjectionThreadGroupInput = typeof GetProjectionThreadGroupInput.Type;

export interface ProjectionThreadGroupRepositoryShape {
  /** Insert or replace a projected group row, keyed by `groupId`. */
  readonly upsert: (row: ProjectionThreadGroup) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Read a projected group row by id, deleted rows included. */
  readonly getById: (
    input: GetProjectionThreadGroupInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadGroup>, ProjectionRepositoryError>;
  /** List every projected group row in creation order. */
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionThreadGroup>,
    ProjectionRepositoryError
  >;
}

export class ProjectionThreadGroupRepository extends Context.Service<
  ProjectionThreadGroupRepository,
  ProjectionThreadGroupRepositoryShape
>()("t3/persistence/Services/ProjectionThreadGroups/ProjectionThreadGroupRepository") {}
