import {
  CommandId,
  IsoDateTime,
  ProjectIconOverride,
  ProjectId,
  ThreadGroupId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "./Errors.ts";

/** Projected thread group rows: user-made sidebar folders of threads. */
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

export const ProjectionThreadGroupDbRow = ProjectionThreadGroup.mapFields(
  Struct.assign({
    icon: Schema.NullOr(Schema.fromJsonString(ProjectIconOverride)),
  }),
);

export class ProjectionThreadGroupRepository extends Context.Service<
  ProjectionThreadGroupRepository,
  {
    /** Insert or replace a projected group row, keyed by `groupId`. */
    readonly upsert: (row: ProjectionThreadGroup) => Effect.Effect<void, ProjectionRepositoryError>;
    /** Read a projected group row by id, deleted rows included. */
    readonly getById: (
      input: GetProjectionThreadGroupInput,
    ) => Effect.Effect<Option.Option<ProjectionThreadGroup>, ProjectionRepositoryError>;
  }
>()("t3/persistence/ProjectionThreadGroups/ProjectionThreadGroupRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadGroup,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_groups (
          group_id,
          project_id,
          name,
          icon_json,
          name_generation_request_id,
          name_generation_started_at,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.groupId},
          ${row.projectId},
          ${row.name},
          ${row.icon === null ? null : JSON.stringify(row.icon)},
          ${row.nameGenerationRequestId},
          ${row.nameGenerationStartedAt},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (group_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          icon_json = excluded.icon_json,
          name_generation_request_id = excluded.name_generation_request_id,
          name_generation_started_at = excluded.name_generation_started_at,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadGroupInput,
    Result: ProjectionThreadGroupDbRow,
    execute: ({ groupId }) =>
      sql`
        SELECT
          group_id AS "groupId",
          project_id AS "projectId",
          name,
          icon_json AS "icon",
          name_generation_request_id AS "nameGenerationRequestId",
          name_generation_started_at AS "nameGenerationStartedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_thread_groups
        WHERE group_id = ${groupId}
      `,
  });

  const upsert: ProjectionThreadGroupRepository["Service"]["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadGroupRepository.upsert:query")),
    );
  const getById: ProjectionThreadGroupRepository["Service"]["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadGroupRepository.getById:query")),
    );

  return ProjectionThreadGroupRepository.of({ upsert, getById });
});

export const layer = Layer.effect(ProjectionThreadGroupRepository, make);
