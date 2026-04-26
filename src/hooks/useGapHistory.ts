import { useCallback, useEffect, useRef, useState } from 'react';
import type { Gap } from '../types';

const EMPTY_GAPS: Gap[] = [];

interface GapHistoryState {
  past: Gap[][];
  present: Gap[] | null;
  future: Gap[][];
}

function createEmptyHistory(): GapHistoryState {
  return {
    past: [],
    present: null,
    future: [],
  };
}

function areGapArraysShallowEqual(left: Gap[], right: Gap[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export default function useGapHistory(baseState: Gap[] | null, limit = 30) {
  const baseStateRef = useRef<Gap[] | null>(baseState);
  const [history, setHistory] = useState<GapHistoryState>(createEmptyHistory);

  useEffect(() => {
    baseStateRef.current = baseState;
    setHistory(createEmptyHistory());
  }, [baseState]);

  const commit = useCallback((nextState: Gap[]) => {
    let didCommit = false;

    setHistory((currentHistory) => {
      const currentState = currentHistory.present ?? baseStateRef.current ?? EMPTY_GAPS;

      if (areGapArraysShallowEqual(currentState, nextState)) {
        return currentHistory;
      }

      didCommit = true;
      const nextPast = [...currentHistory.past, currentState];

      return {
        past: nextPast.slice(-limit),
        present: nextState,
        future: [],
      };
    });

    return didCommit;
  }, [limit]);

  const undo = useCallback(() => {
    let didUndo = false;

    setHistory((currentHistory) => {
      if (currentHistory.past.length === 0) {
        return currentHistory;
      }

      didUndo = true;
      const previousState = currentHistory.past[currentHistory.past.length - 1];
      const currentState = currentHistory.present ?? baseStateRef.current ?? EMPTY_GAPS;

      return {
        past: currentHistory.past.slice(0, -1),
        present: previousState === baseStateRef.current ? null : previousState,
        future: [currentState, ...currentHistory.future],
      };
    });

    return didUndo;
  }, []);

  const redo = useCallback(() => {
    let didRedo = false;

    setHistory((currentHistory) => {
      const [nextState, ...remainingFuture] = currentHistory.future;

      if (!nextState) {
        return currentHistory;
      }

      didRedo = true;
      const currentState = currentHistory.present ?? baseStateRef.current ?? EMPTY_GAPS;

      return {
        past: [...currentHistory.past, currentState].slice(-limit),
        present: nextState,
        future: remainingFuture,
      };
    });

    return didRedo;
  }, [limit]);

  const reset = useCallback(() => {
    setHistory(createEmptyHistory());
  }, []);

  return {
    past: history.past,
    present: history.present,
    future: history.future,
    hasEdits: history.present !== null,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    commit,
    undo,
    redo,
    reset,
  };
}
