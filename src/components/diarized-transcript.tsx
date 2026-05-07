"use client";

export interface DiarizedSegment {
    speaker: string;
    text: string;
    start: number;
    end: number;
    words?: Array<{
        word: string;
        start: number;
        end: number;
        score: number;
        speaker?: string;
    }>;
}

interface DiarizedTranscriptProps {
    segments: DiarizedSegment[];
    className?: string;
}

const SPEAKER_COLORS = [
    "text-cyan-400",
    "text-emerald-400",
    "text-amber-400",
    "text-fuchsia-400",
    "text-rose-400",
    "text-violet-400",
    "text-sky-400",
    "text-orange-400",
];

function speakerColor(speaker: string): string {
    const match = speaker.match(/\d+/);
    const idx = match ? parseInt(match[0], 10) : 0;
    return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

function formatTimestamp(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function DiarizedTranscript({
    segments,
    className = "",
}: DiarizedTranscriptProps) {
    if (!segments || segments.length === 0) {
        return (
            <p className={`text-muted-foreground ${className}`}>
                No segments to display.
            </p>
        );
    }

    return (
        <div className={`space-y-3 ${className}`}>
            {segments.map((segment) => {
                const key = `${segment.speaker}-${segment.start.toFixed(2)}-${segment.end.toFixed(2)}`;
                const colorClass = speakerColor(segment.speaker);
                const timestamp = formatTimestamp(segment.start);

                return (
                    <div key={key} className="flex gap-3 group">
                        <span className="text-xs text-muted-foreground font-mono mt-0.5 shrink-0 w-12 text-right opacity-60 group-hover:opacity-100 transition-opacity">
                            {timestamp}
                        </span>

                        <div className="flex-1 min-w-0">
                            <span
                                className={`text-sm font-semibold ${colorClass}`}
                            >
                                {segment.speaker}
                            </span>
                            <span className="text-sm text-foreground ml-2 leading-relaxed">
                                {segment.text}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
