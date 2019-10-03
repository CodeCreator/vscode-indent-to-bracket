'use strict';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Activated: indent-to-bracket');

    overrideCommand(context, "type", async args => {
        let editor = vscode.window.activeTextEditor;
        if (editor !== undefined && (args.text === "\n" || args.text == "\r\n")) {
            await insertNewLinesAndIndent(editor)
        } else {
            await vscode.commands.executeCommand('default:type', args);
        }
    });
}

// Method borrowed from vim vscode extension
function overrideCommand(context: vscode.ExtensionContext, command: string, callback: (...args: any[]) => any) {
    const disposable = vscode.commands.registerCommand(command, async args => {
        // TODO: add way of disabling extension
        if (!vscode.window.activeTextEditor) {
            await vscode.commands.executeCommand('default:' + command, args);
            return;
        }

        // Not precisely sure why this is important, but if the vim folk think that the behavior of this document
        // should remained unmodified, perhaps I should follow suit!
        if (vscode.window.activeTextEditor.document && vscode.window.activeTextEditor.document.uri.toString() === 'debug:input') {
            await vscode.commands.executeCommand('default:' + command, args);
            return;
        }

        callback(args);
    });

    context.subscriptions.push(disposable);
}

interface IObjectWithStringValues { [key: string]: string; }
interface IObjectWithNumericValues { [key: string]: number; }

class BracketCounter {
    private static get kBracketKeys(): IObjectWithStringValues {
        return {'(': 'paren', ')': 'paren', '[': 'square',']': 'square',
                '{': 'curly', '}': 'curly'};
    }
    tallies: IObjectWithNumericValues = {paren: 0, square: 0, curly: 0};

    private static keyForBracket(bracket: string) {
        return this.kBracketKeys[bracket];
    }

    public addToTallyForBracket(bracket: string, amount: number) {
        this.tallies[BracketCounter.keyForBracket(bracket)] += amount;
    }

    public bracketTallyForBracket(bracket: string) {
        return this.tallies[BracketCounter.keyForBracket(bracket)];
    }

    public areAllBracketsClosed() {
        for (var key in this.tallies) {
            if (this.tallies.hasOwnProperty(key) && this.tallies[key] !== 0) {
                return false;
            }
        }

        return true;
    }
}

function isBracketPair(brackets: string) {
    return brackets === '()' || brackets === '[]' || brackets === '{}';
}

function isOpeningBracket(bracket: string) {
    return bracket === '(' || bracket === '[' || bracket === '{';
}

function isClosingBracket(bracket: string) {
    return bracket === ')' || bracket === ']' || bracket === '}';
}

function allBracketsInString(s: string) {
    var regex = /(\(|\)|\[|\]|{|})/g;
    var indices = new Array();
    var match = null;

    while(match = regex.exec(s)) {
        indices.push(match.index);
    }

    return indices;
}

function columnOfCharacterInLine(line: string, character: number, tabSize: number) {
    var result = 0;

    for (var i = 0; i < character; ++i) {
        if (line[i] == '\t') {
            result += tabSize;
        } else {
            result += 1;
        }
    }

    return result;
}

// Returns null if the given line doesn't indicate the point we want to indent to
function findIndentationPositionInLineAndTallyOpenBrackets(line: string, tallies: BracketCounter, tabSize: number) : number | null {
    var indices = allBracketsInString(line);

    if (indices.length === 0) {
        return null;
    }

    for (var i = indices.length-1; i >= 0; --i) {
        var index = indices[i];
        var char: string = line[index];

        if (isClosingBracket(char)) {
            tallies.addToTallyForBracket(char, 1);
        } else if (tallies.bracketTallyForBracket(char) == 0) {
            // An open bracket that has no matching closing bracket -- we want to indent to the column after it!
            return columnOfCharacterInLine(line, index, tabSize)+1;
        } else {
            tallies.addToTallyForBracket(char, -1);
        }
    }

    return null;
}

function findIndentationPositionOfPreviousOpenBracket(editor: vscode.TextEditor, position: vscode.Position) : number | null {
    var document = editor.document;
    var line_number = position.line;
    // Don't want to consider the entire line if the insertion point isn't at the end:
    var line = document.lineAt(line_number).text.substring(0, position.character);
    var tabSize = editor.options.tabSize as number;

    if (isOpeningBracket(line[line.length - 1])) {
        // We want to use the editor's default indentation in this case
        return null;
    }

    var tallies = new BracketCounter();

    for (var currentLineNumber = line_number; currentLineNumber >= 0; --currentLineNumber) {
        var currentLine = (currentLineNumber === line_number) ? line : document.lineAt(currentLineNumber).text;
        var indentationIndex = findIndentationPositionInLineAndTallyOpenBrackets(currentLine, tallies, tabSize);

        if (indentationIndex !== null) {
            return indentationIndex;
        }

        if (tallies.areAllBracketsClosed()) {
            if (currentLineNumber !== line_number) {
                return columnOfCharacterInLine(
                    currentLine,
                    document.lineAt(currentLineNumber).firstNonWhitespaceCharacterIndex,
                    tabSize);
            } else {
                return null;
            }
        }
    }

    return null;
}

function findDefaultIndentationPosition(editor: vscode.TextEditor, position: vscode.Position, checkOpeningBracket: boolean) : number {
    // Imitate vscode's default indentation behaviour.
    var line = editor.document.lineAt(position.line).text.substring(0, position.character);
    var indentation_index = Math.min(
            position.character,
            editor.document.lineAt(position.line).firstNonWhitespaceCharacterIndex);
    var tabSize = editor.options.tabSize as number;

    let indentation_position = columnOfCharacterInLine(line, indentation_index, tabSize);

    if (checkOpeningBracket && isOpeningBracket(editor.document.lineAt(position.line).text[line.length - 1])) {
        // We want to use the editor's default indentation in this case
        indentation_position += tabSize;
    }

    return indentation_position;
}

function findClosingBracketIndentationPosition(editor: vscode.TextEditor, selection: vscode.Selection) : number {
    let brackets = (
        editor.document.lineAt(selection.start.line).text[selection.start.character-1] +
        editor.document.lineAt(selection.end.line).text[selection.start.character]);
    if (isBracketPair(brackets)) {
        return findDefaultIndentationPosition(editor, selection.start, false);
    }
    return -1;
}

function indentationWhitespaceToColumn(column: number, tabSize: number, insertSpaces: boolean) {
    if (insertSpaces) {
        return ' '.repeat(column);
    } else {
        return '\t'.repeat(column / tabSize) + ' '.repeat(column % tabSize);
    }
}

// Since TextEditor.edit returns a thenable but not a promise, this is a convenience function that calls
// TextEditor.edit and returns a proper promise, allowing for chaining
function editorEdit(editor: vscode.TextEditor, callback: (editBuilder: vscode.TextEditorEdit) => void,
                    options?: {undoStopAfter: boolean, undoStopBefore: boolean}) {
    return new Promise<boolean>((resolve, reject) => {
        editor.edit(callback, options).then((success: boolean) => {
            if (success) {
                resolve(true);

            } else {
                console.log('vscode-indent-to-bracket: Edit failed.')
                reject();
            }
        });
    });
}

async function insertNewLinesAndIndent(editor: vscode.TextEditor) {
    // Sort indices first according to order in document.
    // This order doesn't change when newline and indentation are inserted.
    let sorted_indices = [...editor.selections.keys()]
    sorted_indices.sort(
        (a: number, b: number) => {
            let line_delta = editor.selections[a].start.line - editor.selections[b].start.line;
            if (line_delta == 0) {
                return editor.selections[a].start.character - editor.selections[b].start.character;
            } else {
                return line_delta;
            }
        });

    // Write history.
    await editorEdit(editor, (edit: vscode.TextEditorEdit) => {
        edit.insert(editor.selection.active, '');
    }, { undoStopBefore: true, undoStopAfter: false});

    for (let i = 0; i < sorted_indices.length; ++i) {
        let selection = editor.selections[sorted_indices[i]];
        let closing_bracket_indentation_position = -1;
        let indentation_position = findIndentationPositionOfPreviousOpenBracket(editor, selection.start);
        if (indentation_position === null) {
            closing_bracket_indentation_position = findClosingBracketIndentationPosition(editor, selection);
            indentation_position = findDefaultIndentationPosition(editor, selection.start, true);
        }

        let whitespace = indentationWhitespaceToColumn(
            indentation_position, editor.options.tabSize as number,
            editor.options.insertSpaces as boolean);

        await editorEdit(editor, (edit: vscode.TextEditorEdit) => {
            if (!selection.isEmpty) {
                edit.delete(selection);
            }
            edit.insert(selection.start, '\n' + whitespace);
        }, { undoStopBefore: false, undoStopAfter: false});

        if (closing_bracket_indentation_position >= 0) {
            whitespace = indentationWhitespaceToColumn(
                closing_bracket_indentation_position,
                editor.options.tabSize as number,
                editor.options.insertSpaces as boolean);

            let stored_selections = editor.selections;
            selection = editor.selections[sorted_indices[i]];
            await editorEdit(editor, (edit: vscode.TextEditorEdit) => {
                edit.insert(selection.start, '\n' + whitespace);
            }, { undoStopBefore: false, undoStopAfter: false});
            editor.selections = stored_selections;
        }
    }

    // Write history.
    await editorEdit(editor, (edit: vscode.TextEditorEdit) => {
        edit.insert(editor.selection.active, '');
    }, { undoStopBefore: false, undoStopAfter: true});
}

// this method is called when your extension is deactivated
export function deactivate() {
}
