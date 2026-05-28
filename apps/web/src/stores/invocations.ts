import { create } from 'zustand';
import type { InvocationRecord } from '../lib/protocol';

interface InvocationsState {
  records: InvocationRecord[];
  setRecords: (records: InvocationRecord[]) => void;
  addRecord: (record: InvocationRecord) => void;
}

export const useInvocationsStore = create<InvocationsState>((set) => ({
  records: [],
  setRecords: (records) => set({ records }),
  addRecord: (record) =>
    set((state) => {
      const existingIndex = state.records.findIndex((r) => r.traceId === record.traceId);
      let newRecords = [...state.records];

      if (existingIndex > -1) {
        // 合并更新，避免丢失已有数据（如 API 获取的 args/result 覆盖 WS 事件）
        newRecords[existingIndex] = {
          ...newRecords[existingIndex],
          ...record,
        };
      } else {
        newRecords.unshift(record);
      }

      if (newRecords.length > 100) {
        newRecords = newRecords.slice(0, 100);
      }

      return { records: newRecords };
    }),
}));
