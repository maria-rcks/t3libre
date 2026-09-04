# Project settings

Open **Settings → Projects** and select a project to change its preferences.

When a project group has more than one checkout, select **All machines** to edit its shared name,
icon, model, workspace, and pull behavior. Select a machine tab to view that checkout's path, edit
its grouping and actions, or remove it.

## Project icons

Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to every checkout in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
