import { useState, useCallback, useMemo } from 'react';

export interface UseBulkSelectionOptions<T> {
  items: T[];
  getId: (item: T) => string;
}

export function useBulkSelection<T>({ items, getId }: UseBulkSelectionOptions<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(getId)));
  }, [items, getId]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(getId(item))),
    [items, selectedIds, getId]
  );

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  return {
    selectedIds,
    selectedItems,
    toggle,
    selectAll,
    clearSelection,
    isSelected,
    allSelected,
    someSelected,
    count: selectedIds.size,
  };
}
