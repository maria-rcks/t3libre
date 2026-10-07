import type { LegendListRef } from "@legendapp/list/react";
import type { RunId, RunAttemptId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { CitationHistoryPage } from "./useAssistantCitationTarget";
import type { ThreadFindTarget } from "./ThreadFind";
import { toastManager } from "../ui/toast";

const fold = (text: string) => text.replace(/[A-Z]/g, (character) => character.toLowerCase());

/** Load and unfold the same history used by citation navigation, then pin its virtual row. */
export function useThreadFindTarget({
  target,
  entries,
  rows,
  listRef,
  viewport,
  historyLoading,
  loadEarlier,
  onExpandTurn,
  onExpandAttempt,
  historyError,
  onManualNavigation,
}: {
  target: ThreadFindTarget | null;
  entries: ReadonlyArray<TimelineEntry>;
  rows: ReadonlyArray<MessagesTimelineRow>;
  listRef: RefObject<LegendListRef | null>;
  viewport: HTMLElement | null;
  historyLoading: boolean;
  loadEarlier: CitationHistoryPage | null;
  onExpandTurn: (id: RunId) => void;
  onExpandAttempt: (id: RunAttemptId) => void;
  historyError: string | null;
  onManualNavigation: () => void;
}) {
  const navigation = useRef<{ key: string; pages: Set<string>; finished: boolean } | null>(null);
  const [finishedKey, setFinishedKey] = useState<string | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (!target) {
      navigation.current = null;
      setFinishedKey(null);
      setReadyKey(null);
      return;
    }
    if (navigation.current?.key !== target.key) {
      navigation.current = { key: target.key, pages: new Set(), finished: false };
      setFinishedKey(null);
      setReadyKey(null);
      onManualNavigation();
    }
    const current = navigation.current;
    if (historyLoading || current.finished) return;
    const source = entries.find(
      (entry) => entry.kind === "message" && entry.message.id === target.messageId,
    );
    if (!source) {
      if (!historyError && loadEarlier && !loadEarlier.loading) {
        const cursor = loadEarlier.cursor ?? entries[0]?.id ?? "first";
        if (!current.pages.has(cursor)) {
          current.pages.add(cursor);
          loadEarlier.onLoadEarlier();
        }
        return;
      } else if (loadEarlier?.loading) return;
      current.finished = true;
      setFinishedKey(target.key);
      toastManager.add({
        type: "warning",
        title: "Could not load the matching message",
        description: "Load earlier turns, then try the match again.",
      });
      return;
    }
    const row = rows.find((row) => row.kind === "message" && row.message.id === target.messageId);
    if (!row && source.kind === "message" && source.message.runId) {
      onExpandTurn(source.message.runId);
      if (source.attempt) onExpandAttempt(source.attempt.id);
      return;
    }
    if (row) setReadyKey(target.key);
  }, [
    entries,
    historyLoading,
    loadEarlier,
    onExpandTurn,
    onManualNavigation,
    rows,
    target,
    onExpandAttempt,
    historyError,
  ]);

  const row =
    target && readyKey === target.key
      ? rows.find((row) => row.kind === "message" && row.message.id === target.messageId)
      : undefined;
  useEffect(() => {
    const list = listRef.current;
    if (!target || !row || !list || !viewport) return;
    let cancelled = false;
    let frame: number | null = null;
    let observer: MutationObserver | null = null;
    const resizeObserver = new ResizeObserver(() => schedule());
    let highlight: Highlight | null = null;
    const position = () => {
      if (cancelled) return;
      const source = viewport.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(target.messageId)}"][data-message-role]`,
      );
      if (!source) return;
      resizeObserver.observe(source);
      const body =
        source.querySelector<HTMLElement>(
          "[data-thread-find-text], [data-assistant-citation-source]",
        ) ?? source;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
      const text = fold(nodes.map((node) => node.data).join(""));
      const query = fold(target.query);
      let start = -1;
      for (let occurrence = 0; occurrence <= target.occurrence; occurrence++) {
        const next = text.indexOf(query, start + (start < 0 ? 1 : query.length));
        if (next < 0) {
          start = -1;
          break;
        }
        start = next;
      }
      let range: Range | null = null;
      if (start >= 0) {
        range = document.createRange();
        let offset = 0;
        for (const node of nodes) {
          if (start >= offset && start < offset + node.length) range.setStart(node, start - offset);
          if (start + query.length > offset && start + query.length <= offset + node.length) {
            range.setEnd(node, start + query.length - offset);
            break;
          }
          offset += node.length;
        }
      }
      const scroll = list.getScrollableNode();
      if (!(scroll instanceof HTMLElement)) return;
      const rect = (range ?? body).getBoundingClientRect();
      if (rect.height <= 0) return;
      if (!navigation.current?.finished) {
        const offset = Math.max(
          0,
          scroll.scrollTop +
            rect.top -
            scroll.getBoundingClientRect().top -
            Math.min(100, scroll.clientHeight / 3),
        );
        void list.scrollToOffset({ offset, animated: false }).then(() => {
          if (cancelled) return;
          const positioned = (range ?? body).getBoundingClientRect();
          const bounds = scroll.getBoundingClientRect();
          if (
            navigation.current?.key === target.key &&
            positioned.top < bounds.bottom &&
            positioned.bottom > bounds.top
          ) {
            navigation.current.finished = true;
            setFinishedKey(target.key);
          }
          schedule();
        });
      }
      if (range && typeof Highlight !== "undefined" && CSS.highlights) {
        highlight = new Highlight(range);
        CSS.highlights.set("t3-thread-find", highlight);
      }
    };
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    observer = new MutationObserver(schedule);
    observer.observe(viewport, { childList: true, subtree: true, characterData: true });
    resizeObserver.observe(viewport);
    schedule();
    return () => {
      cancelled = true;
      observer?.disconnect();
      resizeObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (highlight && CSS.highlights?.get("t3-thread-find") === highlight)
        CSS.highlights.delete("t3-thread-find");
    };
  }, [listRef, row, target, viewport]);
  return {
    alwaysRender: row ? { keys: [row.id] } : undefined,
    positioning: target !== null && finishedKey !== target.key,
    key: row ? target?.key : undefined,
  };
}
