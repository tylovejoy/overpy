import { CompletionList, Position } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getCharacterAt, getCharacterBefore, getWordBeforeTrigger } from "./documentUtils";
import { getCompletionState } from "./completionState";

export function getCompletionList(
    document: TextDocument,
    position: Position,
    triggerCharacter?: string,
): CompletionList {
    const state = getCompletionState();

    if (triggerCharacter === ".") {
        const word = getWordBeforeTrigger(document, position);
        if (word === undefined) {
            return state.memberCompletions;
        }

        const constantCompletions = state.constantValueCompletions[word];
        if (constantCompletions) {
            return constantCompletions;
        }

        if (Number.isNaN(Number.parseFloat(word))) {
            return state.memberCompletions;
        }

        return { isIncomplete: false, items: [] };
    }

    if (triggerCharacter === "@") {
        return state.annotationCompletions;
    }

    if (triggerCharacter === "!") {
        return getCharacterBefore(document, position, 2) === "#" ? state.preprocessingCompletions : { isIncomplete: false, items: [] };
    }

    if (triggerCharacter === "&") {
        return getCharacterBefore(document, position, 2) === "\\" ? state.stringEntityCompletions : { isIncomplete: false, items: [] };
    }

    if (["\"", "'"].includes(getCharacterAt(document, position))) {
        return { isIncomplete: false, items: [] };
    }

    return state.defaultCompletions;
}
