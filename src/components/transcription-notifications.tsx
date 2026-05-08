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
    // Keep only the last 200 IDs to prevent unbounded growth
    const ids = [...seen].slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function TranscriptionNotifications() {
    const hasPermissionRef = useRef(false);

    useEffect(() => {
        const poll = async () => {
            try {
                const res = await fetch("/api/me/transcription-events");
                if (!res.ok) return;

                const data = await res.json();
                const events: TranscriptionEvent[] = data.events ?? [];

                const seen = getSeenIds();
                const newEvents = events.filter(
                    (e) => !seen.has(e.transcriptionId),
                );

                if (newEvents.length === 0) return;

                // Request notification permission lazily on first event
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
                // Best-effort — don't spam on failure
            }
        };

        const intervalId = setInterval(poll, POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, []);

    return null;
}
