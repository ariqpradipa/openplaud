"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
    requestNotificationPermission,
    showTranscriptionCompleteNotification,
} from "@/lib/notifications/browser";

interface TranscriptionEvent {
    transcriptionId: string;
    recordingId: string;
    filename: string;
    snippet: string;
}

const POLL_INTERVAL_MS = 5000;
const STORAGE_KEY = "openplaud-seen-transcription-ids";

function getSeenIds(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
}

function markSeen(id: string): void {
    const seen = getSeenIds();
    seen.add(id);
    const ids = [...seen].slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function markSeenBatch(ids: string[]): void {
    if (ids.length === 0) return;
    const seen = getSeenIds();
    for (const id of ids) seen.add(id);
    const all = [...seen].slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function TranscriptionNotifications() {
    const hasPermissionRef = useRef(false);
    const firstPollDoneRef = useRef(false);

    useEffect(() => {
        const poll = async () => {
            try {
                const res = await fetch("/api/me/transcription-events", {
                    cache: "no-store",
                });
                if (!res.ok) return;

                const data = await res.json();
                const events: TranscriptionEvent[] = data.events ?? [];

                if (events.length === 0) return;

                // On the first poll, silently record all existing IDs
                // without showing notifications (prevents flood on mount).
                if (!firstPollDoneRef.current) {
                    firstPollDoneRef.current = true;
                    markSeenBatch(events.map((e) => e.transcriptionId));
                    return;
                }

                const seen = getSeenIds();
                const newEvents = events.filter(
                    (e) => !seen.has(e.transcriptionId),
                );

                if (newEvents.length === 0) return;

                if (!hasPermissionRef.current) {
                    hasPermissionRef.current =
                        await requestNotificationPermission();
                }

                for (const event of newEvents) {
                    toast.success(
                        `Transcription complete: ${event.filename}`,
                    );

                    if (hasPermissionRef.current) {
                        showTranscriptionCompleteNotification(
                            event.filename,
                            event.snippet,
                        );
                    }

                    markSeen(event.transcriptionId);
                }
            } catch {
                // Best-effort
            }
        };

        // Fire immediately to record existing state, then poll
        poll();
        const intervalId = setInterval(poll, POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, []);

    return null;
}
