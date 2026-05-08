"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SummaryTabs } from "@/components/dashboard/summary-tabs";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { useTranscriptionPolling } from "@/hooks/use-transcription-polling";

interface TranscriptionSectionProps {
    recordingId: string;
    initialTranscription?: string;
    initialLanguage?: string | null;
    initialType?: string | null;
}

export function TranscriptionSection({
    recordingId,
    initialTranscription,
    initialLanguage,
    initialType,
}: TranscriptionSectionProps) {
    const [transcription, setTranscription] = useState(initialTranscription);
    const [detectedLanguage, setDetectedLanguage] = useState(initialLanguage);
    const [transcriptionType, setTranscriptionType] = useState(initialType);
    const [summaryFetchKey, setSummaryFetchKey] = useState(0);

    const {
        transcriptionText: liveTranscription,
        isPolling,
        startTranscription,
        cancelTranscription,
    } = useTranscriptionPolling(recordingId, {
        onCompleted: (data) => {
            setTranscription(data.text ?? undefined);
            setDetectedLanguage(data.detectedLanguage || null);
            setTranscriptionType("server");
            setSummaryFetchKey((k) => k + 1);
            toast.success("Transcription complete");
        },
        onFailed: (data) => {
            toast.error(data.errorMessage || "Transcription failed");
        },
    });

    const handleTranscribe = async () => {
        try {
            await startTranscription();
        } catch {
            toast.error("Transcription failed. Please try again.");
        }
    };

    const handleCancel = async () => {
        try {
            await cancelTranscription();
            toast.success("Transcription cancelled");
        } catch {
            toast.error("Failed to cancel");
        }
    };

    return (
        <div className="space-y-6">
            <Panel>
                <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-xl font-bold">Transcription</h2>
                            {detectedLanguage && (
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset">
                                    <LEDIndicator
                                        active
                                        status="active"
                                        size="sm"
                                    />
                                    <span className="text-label text-xs">
                                        Lang:{" "}
                                        <span className="font-mono uppercase text-accent-cyan">
                                            {detectedLanguage}
                                        </span>
                                    </span>
                                </div>
                            )}
                            {transcriptionType && (
                                <span className="text-label text-xs px-3 py-1.5 rounded-lg bg-panel-inset border border-panel-border">
                                    {transcriptionType}
                                </span>
                            )}
                        </div>
                        <MetalButton
                            onClick={
                                isPolling ? handleCancel : handleTranscribe
                            }
                            variant={isPolling ? "orange" : "cyan"}
                            className="w-full md:w-auto"
                        >
                            {isPolling
                                ? "Cancel"
                                : transcription || liveTranscription
                                  ? "Re-transcribe"
                                  : "Transcribe"}
                        </MetalButton>
                    </div>

                    {isPolling ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
                            <p className="text-muted-foreground mb-2">
                                Transcribing…
                            </p>
                        </div>
                    ) : transcription ? (
                        <div className="info-card">
                            <p className="whitespace-pre-wrap leading-relaxed">
                                {transcription}
                            </p>
                        </div>
                    ) : (
                        <Panel variant="inset" className="text-center py-12">
                            <LEDIndicator
                                active={false}
                                status="active"
                                size="md"
                                className="mx-auto mb-4"
                            />
                            <p className="text-muted-foreground mb-2">
                                No transcription yet
                            </p>
                            <p className="text-sm text-text-muted">
                                Click &quot;Transcribe&quot; to generate a
                                transcription
                            </p>
                        </Panel>
                    )}
                </div>
            </Panel>

            {transcription && (
                <SummaryTabs
                    recordingId={recordingId}
                    fetchKey={summaryFetchKey}
                />
            )}
        </div>
    );
}
