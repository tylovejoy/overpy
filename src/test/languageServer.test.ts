import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
    CodeActionKind,
    CompletionItemKind,
    DiagnosticSeverity,
    FoldingRangeKind,
    Hover,
    SymbolKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

import { getCodeActions } from "../languageServer/codeActions";
import { getCompletionList } from "../languageServer/completions";
import { getDefinition, getWorkspaceDefinition } from "../languageServer/definition";
import { toLspDiagnostic } from "../languageServer/diagnostics";
import { getFoldingRanges } from "../languageServer/foldingRanges";
import { getHover } from "../languageServer/hover";
import { getWorkspaceReferences } from "../languageServer/references";
import { getPrepareRename, getWorkspaceRename } from "../languageServer/rename";
import { initializeLanguageServerData, initializeLanguageServerRuntime } from "../languageServer/runtime";
import { getSignatureHelp } from "../languageServer/signatureHelp";
import { getDocumentSymbols } from "../languageServer/symbols";
import { validateTextDocument } from "../languageServer/validation";
import type { CompilationDiagnostic } from "../types";

void main();

async function main(): Promise<void> {
    await initializeLanguageServerData();

    const sourceFileStack = {
        name: "test.opy",
        path: "/tmp/test.opy",
        startLine: 2,
        startCol: 5,
        endLine: 2,
        endCol: 9,
        remainingChars: 0,
        staticMember: true as const,
        fileStackMemberType: "normal" as const,
    };

    const diagnostic = toLspDiagnostic({
        message: "Expected expression",
        severity: "error",
        fileStack: [sourceFileStack],
    } satisfies CompilationDiagnostic);

    assert.deepEqual(diagnostic, {
        message: "Expected expression",
        severity: DiagnosticSeverity.Error,
        range: {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 8 },
        },
        source: "overpy",
    });

    const warning = toLspDiagnostic({
        message: "Check this (w_wait_9999)",
        severity: "warning",
        fileStack: [sourceFileStack],
    } satisfies CompilationDiagnostic);

    assert.equal(warning?.severity, DiagnosticSeverity.Warning);
    assert.equal(warning?.code, "w_wait_9999");

    const annotationDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "rule \"hello\":\n    @");
    const annotationCompletions = getCompletionList(annotationDocument, { line: 1, character: 5 }, "@");
    assert.ok(annotationCompletions.items.some((item) => item.label === "@Event"));

    const memberDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "eventPlayer.");
    const memberCompletions = getCompletionList(memberDocument, { line: 0, character: "eventPlayer.".length }, ".");
    assert.ok(memberCompletions.items.some((item) => item.label === "teleport"));

    const enumDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "Hero.");
    const enumCompletions = getCompletionList(enumDocument, { line: 0, character: "Hero.".length }, ".");
    assert.ok(enumCompletions.items.some((item) => item.label === "ANA"));

    const directiveDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "#!");
    const directiveCompletions = getCompletionList(directiveDocument, { line: 0, character: 2 }, "!");
    assert.ok(directiveCompletions.items.some((item) => item.label === "define"));

    const defaultDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "wa");
    const defaultCompletions = getCompletionList(defaultDocument, { line: 0, character: 2 });
    assert.ok(defaultCompletions.items.some((item) => item.label === "wait" && item.kind === CompletionItemKind.Function));

    const firstParameterDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "wait(");
    const firstParameterHelp = getSignatureHelp(firstParameterDocument, { line: 0, character: "wait(".length }, "(");
    assert.ok(firstParameterHelp);
    assert.match(firstParameterHelp.signatures[0].label, /^wait\(/);
    assert.equal(firstParameterHelp.activeParameter, 0);

    const secondParameterDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "wait(1,");
    const secondParameterHelp = getSignatureHelp(secondParameterDocument, { line: 0, character: "wait(1,".length }, ",");
    assert.ok(secondParameterHelp);
    assert.equal(secondParameterHelp.activeParameter, 1);

    const keywordParameterDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "wait(waitBehavior=");
    const keywordParameterHelp = getSignatureHelp(keywordParameterDocument, { line: 0, character: "wait(waitBehavior=".length });
    assert.ok(keywordParameterHelp);
    assert.equal(keywordParameterHelp.activeParameter, 1);

    const hoverFunctionDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "wait(1)");
    const functionHover = getHover(hoverFunctionDocument, { line: 0, character: 1 });
    assert.ok(functionHover);
    assert.match(getHoverText(functionHover), /^```opy\nwait\(/);
    assert.match(getHoverText(functionHover), /time/);

    const hoverEnumDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "Hero.ANA");
    const enumHover = getHover(hoverEnumDocument, { line: 0, character: "Hero.A".length });
    assert.ok(enumHover);
    assert.match(getHoverText(enumHover), /\*\*Hero\.ANA\*\*/);

    const hoverAnnotationDocument = TextDocument.create("file:///tmp/test.opy", "overpy", 1, "@Event global");
    const annotationHover = getHover(hoverAnnotationDocument, { line: 0, character: 2 });
    assert.ok(annotationHover);
    assert.match(getHoverText(annotationHover), /\*\*@Event\*\*/);

    const structureDocument = TextDocument.create(
        "file:///tmp/structure.opy",
        "overpy",
        1,
        [
            "globalvar score",
            "playervar ultCharge",
            "",
            "enum GameStatus:",
            "    SETUP = 0",
            "    PLAYING = 1",
            "",
            "def resetScore():",
            "    score = 0",
            "",
            "rule \"setup\":",
            "    @Event global",
            "    wait(1)",
        ].join("\n"),
    );
    const symbols = getDocumentSymbols(structureDocument);
    assert.deepEqual(
        symbols.map((symbol) => [symbol.name, symbol.detail, symbol.kind]),
        [
            ["score", "globalvar", SymbolKind.Variable],
            ["ultCharge", "playervar", SymbolKind.Variable],
            ["GameStatus", "enum", SymbolKind.Enum],
            ["resetScore", "def", SymbolKind.Function],
            ["setup", "rule", SymbolKind.Event],
        ],
    );
    assert.deepEqual(symbols.find((symbol) => symbol.name === "setup")?.range, {
        start: { line: 10, character: 0 },
        end: { line: 12, character: 11 },
    });

    const foldingRanges = getFoldingRanges(structureDocument);
    assert.ok(
        foldingRanges.some(
            (range) =>
                range.startLine === 3 &&
                range.endLine === 5 &&
                range.kind === FoldingRangeKind.Region,
        ),
    );
    assert.ok(
        foldingRanges.some(
            (range) =>
                range.startLine === 10 &&
                range.endLine === 12 &&
                range.kind === FoldingRangeKind.Region,
        ),
    );

    assert.ok(warning);
    const codeActions = getCodeActions(structureDocument, [warning]);
    assert.equal(codeActions.length, 1);
    assert.equal(codeActions[0].kind, CodeActionKind.QuickFix);
    assert.equal(codeActions[0].title, "Suppress w_wait_9999 for this file");
    assert.deepEqual(codeActions[0].edit?.changes?.[structureDocument.uri], [
        {
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
            },
            newText: "#!suppressWarnings w_wait_9999\n",
        },
    ]);

    const definitionDocument = TextDocument.create(
        "file:///tmp/definition.opy",
        "overpy",
        1,
        [
            "globalvar score",
            "playervar charge",
            "#!define MAX_SCORE 20",
            "macro SCORE_STEP = 1",
            "enum GameStatus:",
            "    SETUP = 0",
            "    PLAYING = 1",
            "def resetScore():",
            "    score = 0",
            "rule \"use symbols\":",
            "    @Event global",
            "    score = MAX_SCORE + SCORE_STEP",
            "    resetScore()",
            "    status = GameStatus.PLAYING",
            "    eventPlayer.charge = 100",
            "    wait(1)",
        ].join("\n"),
    );

    assert.deepEqual(getDefinition(definitionDocument, { line: 11, character: 6 })?.range, {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 15 },
    });
    assert.deepEqual(getDefinition(definitionDocument, { line: 11, character: 13 })?.range, {
        start: { line: 2, character: 9 },
        end: { line: 2, character: 18 },
    });
    assert.deepEqual(getDefinition(definitionDocument, { line: 11, character: 25 })?.range, {
        start: { line: 3, character: 6 },
        end: { line: 3, character: 16 },
    });
    assert.deepEqual(getDefinition(definitionDocument, { line: 12, character: 5 })?.range, {
        start: { line: 7, character: 4 },
        end: { line: 7, character: 14 },
    });
    assert.deepEqual(getDefinition(definitionDocument, { line: 13, character: 16 })?.range, {
        start: { line: 4, character: 5 },
        end: { line: 4, character: 15 },
    });
    assert.deepEqual(getDefinition(definitionDocument, { line: 13, character: 27 })?.range, {
        start: { line: 6, character: 4 },
        end: { line: 6, character: 11 },
    });
    assert.deepEqual(getDefinition(definitionDocument, { line: 14, character: 17 })?.range, {
        start: { line: 1, character: 10 },
        end: { line: 1, character: 16 },
    });
    assert.equal(getDefinition(definitionDocument, { line: 15, character: 5 }), null);

    const memberVariableDefinitionDocument = TextDocument.create(
        "file:///tmp/member-definition.opy",
        "overpy",
        1,
        [
            "globalvar EditorOn",
            "playervar EditorOn",
            "rule \"use member variable\":",
            "    @Event global",
            "    hostPlayer.EditorOn = true",
            "    EditorOn = true",
        ].join("\n"),
    );
    assert.deepEqual(getDefinition(memberVariableDefinitionDocument, { line: 4, character: 18 })?.range, {
        start: { line: 1, character: 10 },
        end: { line: 1, character: 18 },
    });
    assert.deepEqual(getDefinition(memberVariableDefinitionDocument, { line: 5, character: 6 })?.range, {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 18 },
    });

    const memberVariableReferences = await getWorkspaceReferences(
        memberVariableDefinitionDocument,
        { line: 4, character: 18 },
        [],
        [memberVariableDefinitionDocument],
    );
    assert.deepEqual(
        memberVariableReferences.map((reference) => reference.range),
        [
            {
                start: { line: 1, character: 10 },
                end: { line: 1, character: 18 },
            },
            {
                start: { line: 4, character: 15 },
                end: { line: 4, character: 23 },
            },
        ],
    );

    const globalVariableReferences = await getWorkspaceReferences(
        memberVariableDefinitionDocument,
        { line: 5, character: 6 },
        [],
        [memberVariableDefinitionDocument],
    );
    assert.deepEqual(
        globalVariableReferences.map((reference) => reference.range),
        [
            {
                start: { line: 0, character: 10 },
                end: { line: 0, character: 18 },
            },
            {
                start: { line: 5, character: 4 },
                end: { line: 5, character: 12 },
            },
        ],
    );

    assert.deepEqual(
        await getPrepareRename(memberVariableDefinitionDocument, { line: 4, character: 18 }, [], [memberVariableDefinitionDocument]),
        {
            start: { line: 4, character: 15 },
            end: { line: 4, character: 23 },
        },
    );
    assert.deepEqual(
        await getWorkspaceRename(
            memberVariableDefinitionDocument,
            { line: 4, character: 18 },
            "EditorEnabled",
            [],
            [memberVariableDefinitionDocument],
        ),
        {
            changes: {
                [memberVariableDefinitionDocument.uri]: [
                    {
                        range: {
                            start: { line: 1, character: 10 },
                            end: { line: 1, character: 18 },
                        },
                        newText: "EditorEnabled",
                    },
                    {
                        range: {
                            start: { line: 4, character: 15 },
                            end: { line: 4, character: 23 },
                        },
                        newText: "EditorEnabled",
                    },
                ],
            },
        },
    );
    assert.deepEqual(
        await getWorkspaceRename(
            memberVariableDefinitionDocument,
            { line: 5, character: 6 },
            "GlobalEditorOn",
            [],
            [memberVariableDefinitionDocument],
        ),
        {
            changes: {
                [memberVariableDefinitionDocument.uri]: [
                    {
                        range: {
                            start: { line: 0, character: 10 },
                            end: { line: 0, character: 18 },
                        },
                        newText: "GlobalEditorOn",
                    },
                    {
                        range: {
                            start: { line: 5, character: 4 },
                            end: { line: 5, character: 12 },
                        },
                        newText: "GlobalEditorOn",
                    },
                ],
            },
        },
    );
    assert.deepEqual(
        await getWorkspaceRename(definitionDocument, { line: 13, character: 27 }, "ACTIVE", [], [definitionDocument]),
        {
            changes: {
                [definitionDocument.uri]: [
                    {
                        range: {
                            start: { line: 6, character: 4 },
                            end: { line: 6, character: 11 },
                        },
                        newText: "ACTIVE",
                    },
                    {
                        range: {
                            start: { line: 13, character: 24 },
                            end: { line: 13, character: 31 },
                        },
                        newText: "ACTIVE",
                    },
                ],
            },
        },
    );
    assert.equal(await getPrepareRename(definitionDocument, { line: 15, character: 5 }, [], [definitionDocument]), null);
    assert.equal(
        await getWorkspaceRename(memberVariableDefinitionDocument, { line: 4, character: 18 }, "1Invalid", [], [memberVariableDefinitionDocument]),
        null,
    );

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "overpy-lsp-"));
    try {
        const nestedRoot = path.join(workspaceRoot, "scripts");
        const sharedPath = path.join(nestedRoot, "shared.opy");
        const mainPath = path.join(workspaceRoot, "main.opy");
        await mkdir(nestedRoot);
        await writeFile(
            sharedPath,
            [
                "globalvar sharedScore",
                "enum SharedState:",
                "    READY = 1",
            ].join("\n"),
        );

        const workspaceDocument = TextDocument.create(
            URI.file(mainPath).toString(),
            "overpy",
            1,
            [
                "rule \"use workspace\":",
                "    @Event global",
                "    sharedScore = SharedState.READY",
            ].join("\n"),
        );

        const sharedVariableDefinition = await getWorkspaceDefinition(workspaceDocument, { line: 2, character: 7 }, [workspaceRoot]);
        assert.equal(sharedVariableDefinition?.uri, URI.file(sharedPath).toString());
        assert.deepEqual(sharedVariableDefinition?.range, {
            start: { line: 0, character: 10 },
            end: { line: 0, character: 21 },
        });

        const sharedEnumDefinition = await getWorkspaceDefinition(workspaceDocument, { line: 2, character: 22 }, [workspaceRoot]);
        assert.equal(sharedEnumDefinition?.uri, URI.file(sharedPath).toString());
        assert.deepEqual(sharedEnumDefinition?.range, {
            start: { line: 1, character: 5 },
            end: { line: 1, character: 16 },
        });

        const sharedEnumMemberDefinition = await getWorkspaceDefinition(workspaceDocument, { line: 2, character: 32 }, [workspaceRoot]);
        assert.equal(sharedEnumMemberDefinition?.uri, URI.file(sharedPath).toString());
        assert.deepEqual(sharedEnumMemberDefinition?.range, {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 9 },
        });

        const sharedVariableReferences = await getWorkspaceReferences(workspaceDocument, { line: 2, character: 7 }, [workspaceRoot]);
        assert.deepEqual(
            sharedVariableReferences.map((reference) => [reference.uri, reference.range]),
            [
                [
                    URI.file(sharedPath).toString(),
                    {
                        start: { line: 0, character: 10 },
                        end: { line: 0, character: 21 },
                    },
                ],
                [
                    workspaceDocument.uri,
                    {
                        start: { line: 2, character: 4 },
                        end: { line: 2, character: 15 },
                    },
                ],
            ],
        );
    } finally {
        await rm(workspaceRoot, { force: true, recursive: true });
    }

    await initializeLanguageServerRuntime();

    const invalidDocument = TextDocument.create(
        "file:///tmp/bad.opy",
        "overpy",
        1,
        "rule \"bad\":\n    @Event global\n    wait(",
    );
    const invalidValidation = await validateTextDocument(invalidDocument, "en-US");
    const invalidDiagnostics = invalidValidation.diagnosticsByUri.get(invalidDocument.uri) ?? [];
    assert.ok(invalidDiagnostics.some((item) => item.severity === DiagnosticSeverity.Error));

    const validDocument = TextDocument.create(
        "file:///tmp/good.opy",
        "overpy",
        1,
        "rule \"hello\":\n    @Event global\n    wait(1)",
    );
    const validValidation = await validateTextDocument(validDocument, "en-US");
    const validDiagnostics = validValidation.diagnosticsByUri.get(validDocument.uri) ?? [];
    assert.equal(validDiagnostics.filter((item) => item.severity === DiagnosticSeverity.Error).length, 0);

    console.log("LSP adapter tests passed");
}

function getHoverText(hover: Hover): string {
    if (typeof hover.contents === "string") {
        return hover.contents;
    }

    if (Array.isArray(hover.contents)) {
        return hover.contents.map((item) => (typeof item === "string" ? item : item.value)).join("\n");
    }

    return hover.contents.value;
}
