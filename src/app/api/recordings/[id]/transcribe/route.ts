import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";

async function runTranscription(
    recordingId: string,
    userId: string,
    credentials: typeof apiCredentials.$inferSelect,
    overrideModel: string | undefined,
    recordingStoragePath: string,
    recordingFilename: string,
) {
    console.log(
        `[runTranscription] Starting for recording ${recordingId} with provider ${credentials.provider}`,
    );

    const apiKey = decrypt(credentials.apiKey);

    const storage = await createUserStorageProvider(userId);
    const audioBuffer = await storage.downloadFile(recordingStoragePath);

    const header = new Uint8Array(audioBuffer.slice(0, 4));
    const isOgg =
        header[0] === 0x4f &&
        header[1] === 0x67 &&
        header[2] === 0x67 &&
        header[3] === 0x53;

    const ext = isOgg ? "ogg" : recordingStoragePath.split(".").pop() || "mp3";
    const contentType = isOgg
        ? "audio/ogg"
        : recordingStoragePath.endsWith(".mp3")
          ? "audio/mpeg"
          : "audio/opus";

    const filename = recordingFilename.match(/\.\w{2,4}$/)
        ? recordingFilename
        : `${recordingFilename}.${ext}`;

    const model = overrideModel || credentials.defaultModel || "whisper-1";

    const openai = new OpenAI({
        apiKey,
        baseURL: credentials.baseUrl || undefined,
    });
    const audioFile = new File([new Uint8Array(audioBuffer)], filename, {
        type: contentType,
    });
    const responseFormat = getResponseFormat(model);
    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model,
        response_format: responseFormat,
    });
    const parsed = parseTranscriptionResponse(
        transcription,
        responseFormat,
    );
    const transcriptionText = parsed.text;
    const detectedLanguage = parsed.detectedLanguage;

    await db.transaction(async (tx) => {
        const [stillActive] = await tx
            .select({ deletedAt: recordings.deletedAt })
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                ),
            )
            .for("update")
            .limit(1);

        if (!stillActive || stillActive.deletedAt) return;

        const [existing] = await tx
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, recordingId))
            .limit(1);

        if (!existing || existing.status !== "processing") return;

        if (existing) {
            await tx
                .update(transcriptions)
                .set({
                    text: transcriptionText,
                    detectedLanguage,
                    status: "completed",
                    errorMessage: null,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model,
                })
                .where(eq(transcriptions.id, existing.id));
        } else {
            await tx.insert(transcriptions).values({
                recordingId,
                userId,
                text: transcriptionText,
                detectedLanguage,
                status: "completed",
                transcriptionType: "server",
                provider: credentials.provider,
                model,
            });
        }
    });
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;

        const [transcription] = await db
            .select({
                text: transcriptions.text,
                detectedLanguage: transcriptions.detectedLanguage,
                transcriptionType: transcriptions.transcriptionType,
                status: transcriptions.status,
                errorMessage: transcriptions.errorMessage,
            })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                ),
            )
            .limit(1);

        return NextResponse.json({
            transcription: transcription?.text || null,
            detectedLanguage: transcription?.detectedLanguage || null,
            transcriptionType: transcription?.transcriptionType || null,
            status: transcription?.status || null,
            errorMessage: transcription?.errorMessage || null,
        });
    } catch (error) {
        console.error("Error fetching transcription status:", error);
        return NextResponse.json(
            { error: "Failed to fetch status" },
            { status: 500 },
        );
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const overrideProviderId = body.providerId as string | undefined;
        const overrideModel = body.model as string | undefined;

        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        const [credentials] = overrideProviderId
            ? await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.id, overrideProviderId),
                          eq(apiCredentials.userId, session.user.id),
                      ),
                  )
                  .limit(1)
            : await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.userId, session.user.id),
                          eq(apiCredentials.isDefaultTranscription, true),
                      ),
                  )
                  .limit(1);

        if (!credentials) {
            return NextResponse.json(
                { error: "No transcription API configured" },
                { status: 400 },
            );
        }

        const model = overrideModel || credentials.defaultModel || "whisper-1";

        const [existing] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (existing) {
            await db
                .update(transcriptions)
                .set({
                    text: "",
                    status: "processing",
                    errorMessage: null,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model,
                    detectedLanguage: null,
                })
                .where(eq(transcriptions.id, existing.id));
        } else {
            await db.insert(transcriptions).values({
                recordingId: id,
                userId: session.user.id,
                text: "",
                status: "processing",
                transcriptionType: "server",
                provider: credentials.provider,
                model,
            });
        }

        console.log(
            `[transcribe] Starting background transcription for recording ${id}`,
        );

        void runTranscription(
            id,
            session.user.id,
            credentials,
            overrideModel,
            recording.storagePath,
            recording.filename,
        ).then(
            () =>
                console.log(
                    `[transcribe] Background transcription completed for recording ${id}`,
                ),
            (error) => {
                console.error(
                    "Background transcription failed:",
                    error,
                );
                db.update(transcriptions)
                    .set({
                        status: "failed",
                        errorMessage:
                            error instanceof Error
                                ? error.message
                                : "Transcription failed",
                    })
                    .where(
                        and(
                            eq(transcriptions.recordingId, id),
                            eq(transcriptions.userId, session.user.id),
                        ),
                    )
                    .execute()
                    .catch((updateError) =>
                        console.error(
                            "Failed to update error status:",
                            updateError,
                        ),
                    );
            },
        );

        return NextResponse.json({ status: "processing" });
    } catch (error) {
        console.error("Error starting transcription:", error);
        const message =
            error instanceof Error
                ? error.message
                : "Failed to start transcription";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        await db
            .update(transcriptions)
            .set({ text: "", status: "" })
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                    eq(transcriptions.status, "processing"),
                ),
            );

        return NextResponse.json({ status: "cancelled" });
    } catch (error) {
        console.error("Error cancelling transcription:", error);
        return NextResponse.json(
            { error: "Failed to cancel" },
            { status: 500 },
        );
    }
}
