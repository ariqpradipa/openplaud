"use client";

import { LogOut, Mic, RefreshCw, Settings, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { SyncStatus } from "@/components/sync-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { signOut } from "@/lib/auth-client";
import {
    requestNotificationPermission,
    showNewRecordingNotification,
    showSyncCompleteNotification,
} from "@/lib/notifications/browser";
import { getSyncSettings, SYNC_CONFIG } from "@/lib/sync-config";
import type { Recording } from "@/types/recording";
import { RecordingList } from "./recording-list";
import { RecordingPlayer } from "./recording-player";
import { TranscriptionPanel } from "./transcription-panel";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
}

export function Workstation({ recordings, transcriptions }: WorkstationProps) {
    const router = useRouter();

    const restoreRecording = useCallback((): Recording | null => {
        const savedId =
            typeof window !== "undefined"
                ? localStorage.getItem("openplaud-last-recording")
                : null;
        if (savedId) {
            const found = recordings.find((r) => r.id === savedId);
            if (found) return found;
        }
        return recordings.length > 0 ? recordings[0] : null;
    }, [recordings]);

    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        restoreRecording,
    );

    const selectRecording = useCallback((recording: Recording | null) => {
        setCurrentRecording(recording);
        if (typeof window !== "undefined" && recording?.id) {
            localStorage.setItem("openplaud-last-recording", recording.id);
        }
    }, []);

    const [transcribingIds, setTranscribingIds] = useState<Set<string>>(new Set());
    const isTranscribing = currentRecording
        ? transcribingIds.has(currentRecording.id)
        : false;

    const markTranscribing = useCallback((id: string) => {
        setTranscribingIds((prev) => new Set(prev).add(id));
    }, []);
    const unmarkTranscribing = useCallback((id: string) => {
        setTranscribingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);
    const [isUploading, setIsUploading] = useState(false);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const [providers, setProviders] = useState<
        Array<{
            id: string;
            provider: string;
            baseUrl: string | null;
            defaultModel: string | null;
            isDefaultTranscription: boolean;
            isDefaultEnhancement: boolean;
            createdAt: Date;
        }>
    >([]);
    const [syncSettings, setSyncSettings] = useState<{
        syncInterval: number;
        autoSyncEnabled: boolean;
        syncOnMount: boolean;
        syncOnVisibilityChange: boolean;
        syncNotifications: boolean;
    } | null>(null);
    const [notificationPrefs, setNotificationPrefs] = useState<{
        browserNotifications: boolean;
    } | null>(null);

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    const isProcessing = isTranscribing || isUploading;

    // Keep currentRecording in sync with the recordings prop (updated after router.refresh()).
    // If the previously-selected recording is no longer present (e.g. just deleted),
    // clear the selection rather than holding a stale reference.
    useEffect(() => {
        setCurrentRecording((prev) => {
            if (!prev) return prev;
            const updated = recordings.find((r) => r.id === prev.id);
            return updated ?? null;
        });
    }, [recordings]);

    useEffect(() => {
        if (!currentRecording) return;

        const recordingId = currentRecording.id;
        const ct = transcriptions.get(recordingId);
        if (ct?.text === undefined || ct?.text === "") {
            const controller = new AbortController();
            fetch(`/api/recordings/${recordingId}/transcribe`, {
                signal: controller.signal,
            })
                .then((res) => res.json())
                .then((data) => {
                    if (data.status === "processing") {
                        markTranscribing(recordingId);
                        const interval = setInterval(async () => {
                            try {
                                const statusRes = await fetch(
                                    `/api/recordings/${recordingId}/transcribe`,
                                );
                                if (!statusRes.ok) return;
                                const statusData = await statusRes.json();

                                if (statusData.status === "completed") {
                                    clearInterval(interval);
                                    unmarkTranscribing(recordingId);
                                    toast.success("Transcription complete");
                                    router.refresh();
                                } else if (statusData.status === "failed") {
                                    clearInterval(interval);
                                    unmarkTranscribing(recordingId);
                                    toast.error(
                                        statusData.errorMessage ||
                                            "Transcription failed",
                                    );
                                }
                            } catch {
                            }
                        }, 3000);
                    }
                })
                .catch(() => {});
            return () => controller.abort();
        }
    }, [currentRecording?.id]);

    useEffect(() => {
        getSyncSettings().then(setSyncSettings);
    }, []);

    useEffect(() => {
        const fetchNotificationPrefs = async () => {
            try {
                const res = await fetch("/api/settings/user");
                if (!res.ok) return;
                const data = await res.json();
                setNotificationPrefs({
                    browserNotifications: data.browserNotifications ?? true,
                });
            } catch {
                // best-effort; ignore
            }
        };

        fetchNotificationPrefs();
    }, []);

    useEffect(() => {
        if (!settingsOpen) {
            getSyncSettings().then(setSyncSettings);
        }
    }, [settingsOpen]);

    const {
        isAutoSyncing,
        lastSyncTime,
        nextSyncTime,
        lastSyncResult,
        manualSync,
    } = useAutoSync({
        interval: syncSettings?.syncInterval ?? SYNC_CONFIG.defaultInterval,
        minInterval: SYNC_CONFIG.minInterval,
        syncOnMount: syncSettings?.syncOnMount ?? SYNC_CONFIG.syncOnMount,
        syncOnVisibilityChange:
            syncSettings?.syncOnVisibilityChange ??
            SYNC_CONFIG.syncOnVisibilityChange,
        enabled: syncSettings?.autoSyncEnabled ?? true,
        onSuccess: (newRecordings) => {
            if (syncSettings?.syncNotifications !== false) {
                if (newRecordings > 0) {
                    toast.success(
                        `Synced ${newRecordings} new recording${newRecordings !== 1 ? "s" : ""}`,
                    );
                } else {
                    toast.success("Sync complete - no new recordings");
                }
            }

            if (notificationPrefs?.browserNotifications) {
                (async () => {
                    const granted = await requestNotificationPermission();
                    if (!granted) return;

                    if (newRecordings > 0) {
                        showNewRecordingNotification(newRecordings);
                    } else {
                        showSyncCompleteNotification();
                    }
                })();
            }
        },
        onError: (error) => {
            toast.error(error);
        },
    });

    const handleSync = useCallback(async () => {
        await manualSync();
    }, [manualSync]);

    useEffect(() => {
        if (settingsOpen) {
            fetch("/api/settings/ai/providers")
                .then((res) => res.json())
                .then((data) => setProviders(data.providers || []))
                .catch(() => setProviders([]));
        }
    }, [settingsOpen]);

    const handleTranscribe = useCallback(async () => {
        if (!currentRecording) return;

        const recordingId = currentRecording.id;
        markTranscribing(recordingId);
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/transcribe`,
                { method: "POST" },
            );

            if (!response.ok) {
                const error = await response.json();
                toast.error(error.error || "Transcription failed");
                unmarkTranscribing(recordingId);
                return;
            }

            const data = await response.json();
            if (data.status === "processing") {
                toast.info("Transcription started in background");

                const interval = setInterval(async () => {
                    try {
                        const statusRes = await fetch(
                            `/api/recordings/${recordingId}/transcribe`,
                        );
                        if (!statusRes.ok) return;
                        const statusData = await statusRes.json();

                        if (statusData.status === "completed") {
                            clearInterval(interval);
                            unmarkTranscribing(recordingId);
                            toast.success("Transcription complete");
                            router.refresh();
                        } else if (statusData.status === "failed") {
                            clearInterval(interval);
                            unmarkTranscribing(recordingId);
                            toast.error(
                                statusData.errorMessage ||
                                    "Transcription failed",
                            );
                        }
                    } catch {
                    }
                }, 3000);
            } else {
                unmarkTranscribing(recordingId);
                toast.success("Transcription complete");
                router.refresh();
            }
        } catch {
            toast.error("Failed to transcribe recording");
            unmarkTranscribing(recordingId);
        }
    }, [currentRecording, router, markTranscribing, unmarkTranscribing]);

    const handleCancel = useCallback(async () => {
        if (!currentRecording) return;
        try {
            await fetch(
                `/api/recordings/${currentRecording.id}/transcribe`,
                { method: "DELETE" },
            );
        } catch {
        }
        unmarkTranscribing(currentRecording.id);
    }, [currentRecording, unmarkTranscribing]);

    const handleUpload = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = "";

            setIsUploading(true);
            try {
                const formData = new FormData();
                formData.append("file", file);

                const response = await fetch("/api/recordings/upload", {
                    method: "POST",
                    body: formData,
                });

                if (response.ok) {
                    const data = await response.json();
                    toast.success(`"${data.filename}" uploaded`);
                    router.refresh();
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Upload failed");
                }
            } catch {
                toast.error("Failed to upload recording");
            } finally {
                setIsUploading(false);
            }
        },
        [router],
    );

    return (
        <>
            <div className="bg-background">
                <div className="container mx-auto px-4 py-6 max-w-7xl">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-3xl font-bold">Recordings</h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                {recordings.length} recording
                                {recordings.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <SyncStatus
                                lastSyncTime={lastSyncTime}
                                nextSyncTime={nextSyncTime}
                                isAutoSyncing={isAutoSyncing}
                                lastSyncResult={lastSyncResult}
                                className="hidden md:flex"
                            />
                            <Button
                                onClick={handleSync}
                                disabled={isAutoSyncing}
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                {isAutoSyncing ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Sync Device
                                    </>
                                )}
                            </Button>
                            <input
                                ref={uploadInputRef}
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                onChange={handleUpload}
                            />
                            <Button
                                onClick={() => uploadInputRef.current?.click()}
                                disabled={isProcessing}
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                <Upload className="w-4 h-4 mr-2" />
                                {isUploading ? "Uploading..." : "Upload Audio"}
                            </Button>
                            <Button
                                onClick={() => setSettingsOpen(true)}
                                variant="outline"
                                size="icon"
                                aria-label="Settings"
                            >
                                <Settings className="w-4 h-4" />
                            </Button>
                            <Button
                                onClick={async () => {
                                    await signOut();
                                    router.push("/");
                                    router.refresh();
                                }}
                                variant="outline"
                                size="icon"
                                aria-label="Log out"
                                title="Log out"
                            >
                                <LogOut className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {recordings.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <Mic className="w-16 h-16 text-muted-foreground mb-4" />
                                <h3 className="text-lg font-semibold mb-2">
                                    No recordings yet
                                </h3>
                                <p className="text-muted-foreground text-sm mb-6 text-center max-w-md">
                                    Sync your Plaud device to import your
                                    recordings and start transcribing them.
                                </p>
                                <Button
                                    onClick={handleSync}
                                    disabled={isAutoSyncing}
                                >
                                    {isAutoSyncing ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                            Syncing...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2" />
                                            Sync Device
                                        </>
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1">
                                <RecordingList
                                    recordings={recordings}
                                    currentRecording={currentRecording}
                                    onSelect={selectRecording}
                                />
                            </div>

                            <div className="lg:col-span-2 space-y-6">
                                {currentRecording ? (
                                    <>
                                        <RecordingPlayer
                                            recording={currentRecording}
                                            onEnded={() => {
                                                const currentIndex =
                                                    recordings.findIndex(
                                                        (r) =>
                                                            r.id ===
                                                            currentRecording.id,
                                                    );
                                                if (
                                                    currentIndex >= 0 &&
                                                    currentIndex <
                                                        recordings.length - 1
                                                ) {
                                                    selectRecording(
                                                        recordings[
                                                            currentIndex + 1
                                                        ],
                                                    );
                                                }
                                            }}
                                        />
                                        <TranscriptionPanel
                                            recording={currentRecording}
                                            transcription={currentTranscription}
                                            isTranscribing={isTranscribing}
                                            onTranscribe={handleTranscribe}
                                            onCancel={handleCancel}
                                        />
                                    </>
                                ) : (
                                    <Card>
                                        <CardContent className="py-16 text-center">
                                            <p className="text-muted-foreground">
                                                Select a recording to view
                                                details and transcription
                                            </p>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                initialProviders={providers}
                onReRunOnboarding={() => {
                    setSettingsOpen(false);
                    setOnboardingOpen(true);
                }}
            />

            <OnboardingDialog
                open={onboardingOpen}
                onOpenChange={setOnboardingOpen}
                onComplete={() => {
                    setOnboardingOpen(false);
                    router.refresh();
                }}
            />
        </>
    );
}
