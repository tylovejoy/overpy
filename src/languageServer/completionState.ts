import type {
    Argument,
    AstConstantData,
    AstMacroData,
    MacroData,
    Subroutine,
    Type,
    Variable,
} from "../types";
import {
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    InsertTextFormat,
    MarkupKind,
    ParameterInformation,
    SignatureHelp,
    SignatureInformation,
} from "vscode-languageserver/node";

import { actionKw } from "../data/actions";
import { constantValues } from "../data/constants";
import { opyAnnotations } from "../data/opy/annotations";
import { opyConstants } from "../data/opy/constants";
import { opyFuncs } from "../data/opy/functions";
import { opyKeywords } from "../data/opy/keywords";
import { opyMacros } from "../data/opy/macros";
import { opyMemberFuncs } from "../data/opy/memberFunctions";
import { opyModules } from "../data/opy/modules";
import { preprocessingDirectives } from "../data/opy/preprocessing";
import { opyStringEntities } from "../data/opy/stringEntities";
import { valueFuncKw } from "../data/values";
import { builtInEnumNameToAstInfo } from "../compiler/parser";
import { astToOpy } from "../decompiler/astToOpy";
import type { Ast } from "../utils/ast";
import { typeToString } from "../utils/logging";

type CompletionData = {
    args?: Argument[] | null;
    class?: string | String;
    description?: string;
    extension?: string;
    hideFromAutocomplete?: boolean;
    isMember?: boolean;
    macro?: string;
    return?: Type | Type[];
    snippet?: string;
};

export type CompletionCompileResult = {
    macros: MacroData[];
    astMacros: Record<string, AstMacroData>;
    astConstants: Record<string, AstConstantData>;
    globalVariables: Variable[];
    playerVariables: Variable[];
    subroutines: Subroutine[];
    enumMembers: Record<string, Record<string, Ast>>;
    activatedExtensions: string[];
    spentExtensionPoints: number;
    availableExtensionPoints: number;
};

type DynamicCompletionData = {
    activatedExtensions: string[];
    availableExtensionPoints: number;
    globalVariables: Record<string, CompletionData>;
    memberAstConstants: Record<string, CompletionData>;
    memberAstMacros: Record<string, CompletionData>;
    memberMacros: Record<string, CompletionData>;
    normalAstConstants: Record<string, CompletionData>;
    normalAstMacros: Record<string, CompletionData>;
    normalMacros: Record<string, CompletionData>;
    playerVariables: Record<string, CompletionData>;
    spentExtensionPoints: number;
    subroutines: Record<string, CompletionData>;
    userEnums: Record<string, Record<string, Ast>>;
};

export type CompletionState = {
    annotationCompletions: CompletionList;
    constantValueCompletions: Record<string, CompletionList>;
    defaultCompletions: CompletionList;
    functionRegistry: Record<string, CompletionData>;
    memberCompletions: CompletionList;
    preprocessingCompletions: CompletionList;
    stringEntityCompletions: CompletionList;
};

const emptyList = (): CompletionList => ({ isIncomplete: false, items: [] });

let baseFunctionData: Record<string, CompletionData> = {};
let baseMemberFunctionData: Record<string, CompletionData> = {};
let baseModuleFunctionData: Record<string, CompletionData> = {};
let baseConstantValueCompletions: Record<string, CompletionList> = {};
let completionState: CompletionState = {
    annotationCompletions: emptyList(),
    constantValueCompletions: {},
    defaultCompletions: emptyList(),
    functionRegistry: {},
    memberCompletions: emptyList(),
    preprocessingCompletions: emptyList(),
    stringEntityCompletions: emptyList(),
};
let initialized = false;

let dynamicCompletionData: DynamicCompletionData = {
    activatedExtensions: [],
    availableExtensionPoints: -1,
    globalVariables: {},
    memberAstConstants: {},
    memberAstMacros: {},
    memberMacros: {},
    normalAstConstants: {},
    normalAstMacros: {},
    normalMacros: {},
    playerVariables: {},
    spentExtensionPoints: -1,
    subroutines: {},
    userEnums: {},
};

export function initializeCompletionState(): void {
    if (initialized) {
        return;
    }

    buildBaseCompletionData();
    refreshCompletionState();
    initialized = true;
}

export function getCompletionState(): CompletionState {
    initializeCompletionState();
    return completionState;
}

export function updateCompletionStateFromCompileResult(compileResult: CompletionCompileResult): void {
    initializeCompletionState();

    dynamicCompletionData = {
        activatedExtensions: compileResult.activatedExtensions,
        availableExtensionPoints: compileResult.availableExtensionPoints,
        globalVariables: getVariableCompletions(compileResult.globalVariables, "global"),
        memberAstConstants: {},
        memberAstMacros: {},
        memberMacros: {},
        normalAstConstants: {},
        normalAstMacros: {},
        normalMacros: {},
        playerVariables: getVariableCompletions(compileResult.playerVariables, "player"),
        spentExtensionPoints: compileResult.spentExtensionPoints,
        subroutines: getSubroutineCompletions(compileResult.subroutines),
        userEnums: compileResult.enumMembers,
    };

    fillMacroCompletions(compileResult.macros);
    fillAstMacroCompletions(Object.values(compileResult.astMacros));
    fillAstConstantCompletions(Object.values(compileResult.astConstants));
    refreshCompletionState();
}

export function makeSignatureHelp(
    funcName: string,
    func: CompletionData,
    activeParameter: number,
    keywordArgument: string | null,
): SignatureHelp | undefined {
    if (!Array.isArray(func.args) || func.args.length === 0) {
        return undefined;
    }

    if (keywordArgument !== null) {
        const keywordIndex = func.args.findIndex((arg) => arg.name === keywordArgument);
        if (keywordIndex >= 0) {
            activeParameter = keywordIndex;
        }
    }

    const isMemberFunction = func.isMember === true;
    const visibleArgs = isMemberFunction ? func.args.slice(1) : func.args;
    if (visibleArgs.length === 0) {
        return undefined;
    }

    let signatureLabel = "";
    if (func.class) {
        signatureLabel += `${func.class}.`;
    } else if (isMemberFunction) {
        signatureLabel += "Player.";
    }

    signatureLabel += `${funcName}(`;
    const parameters: ParameterInformation[] = [];

    for (let index = 0; index < visibleArgs.length; index++) {
        const arg = visibleArgs[index];
        let argLabel = arg.name;
        if (arg.default !== undefined) {
            argLabel += `=${argDefaultToString(arg)}`;
        }

        const start = signatureLabel.length;
        signatureLabel += argLabel;
        parameters.push({
            label: [start, signatureLabel.length],
            documentation: {
                kind: MarkupKind.Markdown,
                value: `${arg.description ? `${arg.description}\n\n` : ""}Type: \`${typeToString(arg.type)}\``,
            },
        });

        if (index < visibleArgs.length - 1) {
            signatureLabel += ", ";
        }
    }

    signatureLabel += ")";
    if (func.return !== undefined) {
        signatureLabel += ` -> ${typeToString(func.return as Type)}`;
    }

    const signature: SignatureInformation = {
        label: signatureLabel,
        parameters,
    };

    return {
        activeSignature: 0,
        activeParameter: Math.min(activeParameter, visibleArgs.length - 1),
        signatures: [signature],
    };
}

export function makeFunctionSignatureLabel(funcName: string, func: CompletionData): string {
    const isMemberFunction = func.isMember === true;
    const visibleArgs = Array.isArray(func.args) ? (isMemberFunction ? func.args.slice(1) : func.args) : [];

    let label = "";
    if (func.class) {
        label += `${func.class}.`;
    } else if (isMemberFunction) {
        label += "Player.";
    }

    label += `${funcName}(`;
    label += visibleArgs
        .map((arg) => (arg.default !== undefined ? `${arg.name}=${argDefaultToString(arg)}` : arg.name))
        .join(", ");
    label += ")";

    if (func.return !== undefined) {
        label += ` -> ${typeToString(func.return as Type)}`;
    }

    return label;
}

function buildBaseCompletionData(): void {
    const funcDoc: Record<string, CompletionData> = {
        ...actionKw,
        ...valueFuncKw,
        ...opyFuncs,
        ...opyMacros,
    };

    baseFunctionData = Object.fromEntries(
        Object.entries(opyKeywords)
            .filter(([_, item]) => !item.hideFromAutocomplete)
            .map(([key, item]) => [key, item]),
    );
    baseMemberFunctionData = Object.fromEntries(Object.entries(opyMemberFuncs));

    for (const [key, value] of Object.entries(funcDoc)) {
        if (value.hideFromAutocomplete) {
            continue;
        }
        if (key.startsWith(".")) {
            baseMemberFunctionData[key.substring(1)] = { ...value, isMember: true };
            continue;
        }
        if (!key.startsWith("__") && !key.endsWith("__") && !key.includes(".")) {
            baseFunctionData[key] = value;
        }
    }

    baseModuleFunctionData = Object.fromEntries(
        Object.entries(opyModules).flatMap(([moduleName, module]) =>
            Object.entries(module)
                .filter(isModuleFunctionEntry)
                .map(([functionName, func]) => [functionName, { ...func, class: moduleName }]),
        ),
    );

    baseConstantValueCompletions = makeDefaultConstantValueCompletions();

    completionState.annotationCompletions = makeCompletionList(opyAnnotations, CompletionItemKind.Property);
    completionState.preprocessingCompletions = makeCompletionList(preprocessingDirectives, CompletionItemKind.Property);
    completionState.stringEntityCompletions = makeCompletionList(
        Object.fromEntries(
            Object.entries(opyStringEntities).map(([entity, data]) => [
                entity,
                {
                    description: `# ${String.fromCodePoint(data.codepoint)}  \nU+${data.codepoint.toString(16).padStart(4, "0").toUpperCase()}  \n\n${data.description}`,
                    snippet: `${entity};`,
                },
            ]),
        ),
        CompletionItemKind.Text,
    );
}

function refreshCompletionState(): void {
    const constantValueCompletions = {
        ...baseConstantValueCompletions,
        ...getUserEnumCompletionLists(dynamicCompletionData.userEnums),
    };

    for (const constType of ["Beam", "Effect", "DynamicEffect"]) {
        const baseList = baseConstantValueCompletions[constType];
        if (!baseList) {
            continue;
        }

        constantValueCompletions[constType] = {
            isIncomplete: false,
            items: baseList.items.filter((item) => {
                const constantEntry = constantValues[constType]?.[item.label];
                return !constantEntry || !("extension" in constantEntry) || dynamicCompletionData.activatedExtensions.includes(constantEntry.extension ?? "<INVALID>");
            }),
        };
    }

    const defaultItems: Record<string, CompletionData> = {
        ...baseFunctionData,
        ...Object.fromEntries(Object.keys(constantValueCompletions).map((key) => [key, { description: `The \`${key}\` enum.` }])),
        ...dynamicCompletionData.normalAstConstants,
        ...dynamicCompletionData.normalMacros,
        ...dynamicCompletionData.normalAstMacros,
        ...dynamicCompletionData.globalVariables,
        ...dynamicCompletionData.subroutines,
    };

    const memberItems: Record<string, CompletionData> = {
        ...baseMemberFunctionData,
        ...dynamicCompletionData.memberMacros,
        ...dynamicCompletionData.memberAstConstants,
        ...dynamicCompletionData.memberAstMacros,
        ...dynamicCompletionData.playerVariables,
    };

    completionState = {
        ...completionState,
        constantValueCompletions,
        defaultCompletions: makeCompletionList(defaultItems, CompletionItemKind.Function),
        functionRegistry: {
            ...baseFunctionData,
            ...baseMemberFunctionData,
            ...baseModuleFunctionData,
            ...dynamicCompletionData.normalAstConstants,
            ...dynamicCompletionData.normalMacros,
            ...dynamicCompletionData.normalAstMacros,
            ...dynamicCompletionData.memberAstConstants,
            ...dynamicCompletionData.memberMacros,
            ...dynamicCompletionData.memberAstMacros,
        },
        memberCompletions: makeCompletionList(memberItems, CompletionItemKind.Method),
    };
}

function makeDefaultConstantValueCompletions(): Record<string, CompletionList> {
    const allConstants = { ...constantValues, ...opyConstants, ...opyModules };
    const completionLists: Record<string, CompletionList> = {};

    for (const [key, value] of Object.entries(allConstants)) {
        if (key.startsWith("__") && key.endsWith("__")) {
            continue;
        }

        const normalizedKey = key.endsWith("Literal") ? key.substring(0, key.length - "Literal".length) : key;
        if (!isCompletionDataRecord(value)) {
            continue;
        }

        completionLists[normalizedKey] = makeCompletionList(filterOw2Values(value), CompletionItemKind.EnumMember);
    }

    return completionLists;
}

function getUserEnumCompletionLists(userEnums: Record<string, Record<string, Ast>>): Record<string, CompletionList> {
    const result: Record<string, CompletionList> = {};

    for (const [enumName, members] of Object.entries(userEnums)) {
        result[enumName] = {
            isIncomplete: false,
            items: Object.entries(members).map(([memberName, memberAst]) => {
                let description = "A user-defined enum member.";
                try {
                    description += `\n\nValue: \`${astToOpy(memberAst)}\``;
                } catch (e) {}

                return makeCompletionItem(memberName, { description }, CompletionItemKind.EnumMember);
            }),
        };
    }

    return result;
}

function fillMacroCompletions(macros: MacroData[]): void {
    dynamicCompletionData.normalMacros = {};
    dynamicCompletionData.memberMacros = {};

    for (const macro of macros) {
        const convertedMacro: CompletionData = {
            args: [],
            description: macro.isFunction && macro.isScript ? `This macro executes the script: ${macro.scriptPath}` : `This macro resolves to:\n\n${macro.replacement}`,
        };

        let macroName = macro.name;
        if (macro.isFunction) {
            if (macro.args.length === 0) {
                macroName += "()";
            } else {
                convertedMacro.args = macro.args.map((arg: string) => ({ name: arg, type: "Object" }));
            }
        }

        if (macro.isMember) {
            dynamicCompletionData.memberMacros[macroName] = convertedMacro;
        } else {
            dynamicCompletionData.normalMacros[macroName] = convertedMacro;
        }
    }
}

function fillAstMacroCompletions(macros: AstMacroData[]): void {
    dynamicCompletionData.normalAstMacros = {};
    dynamicCompletionData.memberAstMacros = {};

    for (const macro of macros) {
        const convertedMacro: CompletionData = {
            args: [],
            class: macro.class_,
            description: `This macro resolves to:\n\n\`${macro.linesStr.join("`\n`")}\``,
        };
        let macroName = macro.name;

        if (macro.args.length === 0) {
            macroName += "()";
        } else {
            convertedMacro.args = macro.args
                .filter((arg) => arg.name !== "self")
                .map((arg) => ({
                    name: arg.name,
                    type: arg.type,
                    default: arg.defaultStr,
                }));
        }

        if (macro.class_) {
            dynamicCompletionData.memberAstMacros[macroName.replace(".", "")] = convertedMacro;
        } else {
            dynamicCompletionData.normalAstMacros[macroName] = convertedMacro;
        }
    }
}

function fillAstConstantCompletions(constants: AstConstantData[]): void {
    dynamicCompletionData.normalAstConstants = {};
    dynamicCompletionData.memberAstConstants = {};

    for (const constant of constants) {
        const convertedConstant: CompletionData = {
            args: null,
            class: constant.class_,
            description: `This macro resolves to:\n\n\`${constant.valueStr}\``,
        };

        if (constant.class_) {
            dynamicCompletionData.memberAstConstants[constant.name.replace(".", "")] = convertedConstant;
        } else {
            dynamicCompletionData.normalAstConstants[constant.name] = convertedConstant;
        }
    }
}

function getVariableCompletions(variables: Variable[], scope: "global" | "player"): Record<string, CompletionData> {
    return Object.fromEntries(
        variables.map((variable) => [
            variable.name,
            {
                description: variable.index !== -1 ? `A ${scope} variable. (index: ${variable.index})` : `A ${scope} variable.`,
            },
        ]),
    );
}

function getSubroutineCompletions(subroutineNames: Subroutine[]): Record<string, CompletionData> {
    return Object.fromEntries(
        subroutineNames.map((subroutine) => [
            `${subroutine.name}()`,
            {
                args: [],
                description: subroutine.index ? `A subroutine. (index: ${subroutine.index})` : "A subroutine.",
            },
        ]),
    );
}

function makeCompletionList(obj: Record<string, unknown>, defaultKind: CompletionItemKind): CompletionList {
    return {
        isIncomplete: false,
        items: Object.keys(obj)
            .filter((key) => typeof obj[key] === "object" && obj[key] !== null && !(key.startsWith("__") && key.endsWith("__")))
            .map((key) => makeCompletionItem(key, obj[key] as CompletionData, getCompletionKind(key, obj[key] as CompletionData, defaultKind))),
    };
}

function makeCompletionItem(itemName: string, item: CompletionData, kind: CompletionItemKind): CompletionItem {
    const label = itemName.endsWith("()") ? itemName.substring(0, itemName.length - 2) : itemName;
    const completionItem: CompletionItem = {
        label,
        kind,
    };

    const documentation = generateDocumentation(itemName, item);
    if (documentation) {
        completionItem.documentation = {
            kind: MarkupKind.Markdown,
            value: documentation,
        };
    }

    const snippet = generateSnippet(itemName, item);
    if (snippet !== label) {
        completionItem.insertText = snippet;
        completionItem.insertTextFormat = InsertTextFormat.Snippet;
    }

    return completionItem;
}

function generateDocumentation(itemName: string, item: CompletionData): string {
    let result = typeof item.description === "string" ? item.description : "";
    const info: string[] = [];
    const isMemberFunction = item.isMember === true;

    if (Array.isArray(item.args) && (item.args.length > 1 || (item.args.length > 0 && !isMemberFunction))) {
        const args = item.args.slice(isMemberFunction ? 1 : 0).map((arg) => {
            const defaultText = arg.default !== undefined ? ` If omitted, defaults to \`${argDefaultToString(arg).replaceAll("_", "_\u200B")}\`.` : "";
            return `- \`${arg.name}${arg.default !== undefined ? "?" : ""}\`${arg.description ? `: ${arg.description}${arg.description.endsWith(".") ? "" : "."}` : ""}${defaultText}`;
        });
        info.push(`Arguments:\n${args.join("\n")}`);
    }

    if (isMemberFunction) {
        info.push("Class: `Player`");
    } else if (item.class) {
        info.push(`Class: \`${item.class}\``);
    }

    if (item.return !== undefined) {
        info.push(`Returns: \`${typeToString(item.return as Type)}\``);
    }

    if (item.extension) {
        info.push(`Part of extension \`${item.extension}\`.`);
    }

    if (item.macro) {
        info.push(`This macro resolves to:\n\`${item.macro.trim().replaceAll("$", "")}\``);
    }

    if (info.length > 0) {
        result += `${result ? "\n\n" : ""}${info.join("  \n")}`;
    }

    return result || (itemName ? `<no documentation found for \`${itemName}\`>` : "");
}

function generateSnippet(itemName: string, item: CompletionData): string {
    if (itemName.startsWith("@")) {
        return getSnippetForMetaRuleParam(itemName);
    }

    if (typeof item.snippet === "string") {
        return item.snippet;
    }

    if (!Array.isArray(item.args)) {
        return itemName;
    }

    const isMemberFunction = item.isMember === true;
    if (item.args.length === 0 || (item.args.length === 1 && isMemberFunction)) {
        return itemName.endsWith("()") ? itemName : `${itemName}()`;
    }

    return itemName;
}

function getSnippetForMetaRuleParam(param: string): string {
    if (param === "@Name") {
        return 'Name "$0"';
    }

    let result = param.substring(1);
    const ruleParam = opyAnnotations[param];
    if (ruleParam?.args?.[0]) {
        if (ruleParam.args[0].values) {
            result += ` \${1|${ruleParam.args[0].values.filter((value) => !(value.startsWith("__") && value.endsWith("__"))).join(",")}|}`;
        } else {
            result += " ";
        }
    }

    return result;
}

function argDefaultToString(arg: Argument): string {
    if (typeof arg.type === "string" && (arg.type in constantValues || arg.type in builtInEnumNameToAstInfo)) {
        return `${arg.type}.${arg.default}`;
    }

    return `${arg.default}`;
}

function getCompletionKind(itemName: string, item: CompletionData, defaultKind: CompletionItemKind): CompletionItemKind {
    if (itemName.startsWith("@")) {
        return CompletionItemKind.Property;
    }
    if (item.args === null) {
        return CompletionItemKind.Value;
    }
    if (Array.isArray(item.args)) {
        return item.isMember ? CompletionItemKind.Method : CompletionItemKind.Function;
    }
    if (defaultKind === CompletionItemKind.Function && itemName === itemName.toUpperCase()) {
        return CompletionItemKind.EnumMember;
    }
    return defaultKind;
}

function isCompletionDataRecord(value: unknown): value is Record<string, CompletionData> {
    return typeof value === "object" && value !== null && "description" in value;
}

function filterOw2Values(value: Record<string, CompletionData>): Record<string, CompletionData> {
    return Object.fromEntries(
        Object.entries(value).filter(([key, constant]) => key === "description" || !("onlyInOw1" in constant) || !constant.onlyInOw1),
    );
}

function isModuleFunctionEntry(
    entry: [string, string | { description: string; args: Argument[]; return: Type }],
): entry is [string, { description: string; args: Argument[]; return: Type }] {
    return typeof entry[1] !== "string";
}
