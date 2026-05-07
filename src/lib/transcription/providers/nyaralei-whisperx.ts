import { decrypt } from "@/lib/encryption";

export interface WhisperXWord {
    word: string;
    start: number;
    end: number;
    score: number;
    speaker?: string;
}

export interface WhisperXSegment {
    start: number;
    end: number;
    text: string;
    speaker: string;
    words?: WhisperXWord[];
    avg_logprob?: number;
}

export interface WhisperXResponse {
    text: string;
    language: string;
    segments: WhisperXSegment[];
    word_segments?: WhisperXWord[];
}

export interface DiarizedTranscriptSegment {
    speaker: string;
    text: string;
    start: number;
    end: number;
    words?: WhisperXWord[];
}

export interface TranscribeWhisperXResult {
    text: string;
    detectedLanguage: string | null;
    diarizedSegments: DiarizedTranscriptSegment[] | null;
}

function formatSpeakerLabel(speaker: string): string {
    const match = speaker.match(/SPEAKER_(\d+)/);
    if (match) {
        const num = parseInt(match[1], 10);
        return `Speaker ${num + 1}`;
    }
    return speaker;
}

export function mergeConsecutiveSpeakerSegments(
    segments: WhisperXSegment[],
): DiarizedTranscriptSegment[] {
    if (!segments || segments.length === 0) return [];

    const merged: DiarizedTranscriptSegment[] = [];
    let current: DiarizedTranscriptSegment = {
        speaker: formatSpeakerLabel(segments[0].speaker),
        text: segments[0].text,
        start: segments[0].start,
        end: segments[0].end,
        words: segments[0].words ? [...segments[0].words] : undefined,
    };

    for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        const segSpeakerLabel = formatSpeakerLabel(seg.speaker);

        if (segSpeakerLabel === current.speaker) {
            current.text += ` ${seg.text}`;
            current.end = seg.end;
            if (seg.words && current.words) {
                current.words.push(...seg.words);
            }
        } else {
            merged.push(current);
            current = {
                speaker: segSpeakerLabel,
                text: seg.text,
                start: seg.start,
                end: seg.end,
                words: seg.words ? [...seg.words] : undefined,
            };
        }
    }
    merged.push(current);

    return merged;
}

export function buildDiarizedText(
    mergedSegments: DiarizedTranscriptSegment[],
): string {
    return mergedSegments
        .map((seg) => `${seg.speaker}: ${seg.text}`)
        .join("\n");
}

export async function transcribeWithWhisperX(
    encryptedApiKey: string,
    baseUrl: string,
    model: string,
    audioFile: File,
): Promise<TranscribeWhisperXResult> {
    const apiKey = decrypt(encryptedApiKey);
    const base = baseUrl.replace(/\/+$/, "");

    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("model", model || "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("diarize", "true");
    formData.append("align", "true");

    const response = await fetch(`${base}/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
            `WhisperX transcription failed (${response.status}): ${errorBody}`,
        );
    }

    const data = (await response.json()) as WhisperXResponse;

    const merged = mergeConsecutiveSpeakerSegments(data.segments);
    const text = buildDiarizedText(merged);

    return {
        text,
        detectedLanguage: data.language ?? null,
        diarizedSegments: merged,
    };
}
