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
                '{': 'curly', '}': 'curly', '<': 'angle', '>': 'angle'};
    }
    tallies: IObjectWithNumericValues = {paren: 0, square: 0, curly: 0, angle: 0};

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
        for(var key in this.tallies) {
            if (this.tallies.hasOwnProperty(key) && this.tallies[key] !== 0) {
                return false;
            }
        }

        return true;
    }
}

function isClosingBracket(bracket: string) {
    return bracket === ')' || bracket === ']' || bracket === '}' || bracket == '>';
}

function doesLineEndWithOpenBracket(line: string) {
    var regex = /(\(|\[|{)\s*$/g;
    return line.search(regex) !== -1;
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

    for(var i = 0; i < character; ++i) {
        if (line[i] == '\t') {
            result += tabSize;
        } else {
            result += 1;
        }
    }

    return result;
}

function indentationIndex(line: string) {
    var indentation_index = 0;
    for (var i = 0; i < line.length; ++i) {
        if (line[i] == ' ' || line[i] == '\t') {
            ++indentation_index;
        } else {
            break;
        }
    }
    return indentation_index;
}

// Returns null if the given line doesn't indicate the point we want to indent to
function findIndentationPositionInLineAndTallyOpenBrackets(line: string, tallies: BracketCounter, tabSize: number) : number | null {
    var indices = allBracketsInString(line);

    if (indices.length === 0) {
        return null;
    }

    for(var i = indices.length-1; i >= 0; --i) {
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
    var startingLineNumber = position.line;
    // Don't want to consider the entire line if the insertion point isn't at the end:
    var startingLine = document.lineAt(startingLineNumber).text.substring(0, position.character);
    var tabSize = editor.options.tabSize as number;

    if (doesLineEndWithOpenBracket(startingLine)) {
        // We want to use the editor's default indentation in this case
        return null;
    }

    var tallies = new BracketCounter();

    for(var currentLineNumber = startingLineNumber; currentLineNumber >= 0; --currentLineNumber) {
        var currentLine = (currentLineNumber === startingLineNumber) ? startingLine : document.lineAt(currentLineNumber).text;
        var indentationIndex = findIndentationPositionInLineAndTallyOpenBrackets(currentLine, tallies, tabSize);

        if (indentationIndex !== null) {
            return indentationIndex;
        }

        if (tallies.areAllBracketsClosed()) {
            if (currentLineNumber !== startingLineNumber) {
                return columnOfCharacterInLine(currentLine, document.lineAt(currentLineNumber).firstNonWhitespaceCharacterIndex,
                                               tabSize);
            } else {
                return null;
            }
        }
    }

    return null;
}

function findDefaultIndentationPosition(editor: vscode.TextEditor, position: vscode.Position) : number {
    // Imitate vscode's default indentation behaviour.
    // Warning: does not put closing brackets on extra new line.
    var document = editor.document;
    var startingLineNumber = position.line;
    // Don't want to consider the entire line if the insertion point isn't at the end:
    var startingLine = document.lineAt(startingLineNumber).text.substring(0, position.character);
    var indentation_index = indentationIndex(startingLine);
    var tabSize = editor.options.tabSize as number;
    var line_indentation = columnOfCharacterInLine(startingLine, indentation_index, tabSize);
    if (doesLineEndWithOpenBracket(startingLine)) {
        // We want to use the editor's default indentation in this case
        line_indentation += tabSize;
    }
    return line_indentation;
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
                reject();
            }
        });
    });
}

function performInsertEditWithWorkingRedo(editor: vscode.TextEditor, selections: vscode.Selection[], texts: string[]) {
    return new Promise<boolean>(async (resolve, reject) => {
        editorEdit(editor, (edit: vscode.TextEditorEdit) => {
            for(let i = 0; i < selections.length; ++i) {
                let selection = selections[i];
                if (!selection.isEmpty) {
                    edit.delete(selection);
                }
                edit.insert(selection.start, texts[i]);
            }
        }, { undoStopBefore: false, undoStopAfter: false }).catch(() => {
            // If the first edit goes wrong, we want to reject the promise so that we'll fall back on the
            // VS Code's default behavhior.
            console.log('indent-to-bracket error: edit failed!');
            reject();
        }).then(() => {
            resolve();
        });
    });
}

async function insertNewLinesAndIndent(editor: vscode.TextEditor) {
    let selection_indices_covered = new Set();
    // TODO: one way to still break this is by having multiple cursors on
    // different bracket levels in same line. But this should be a very minor use case.

    // Write undo history.
    await editorEdit(
        editor, (edit: vscode.TextEditorEdit) => {
            edit.insert(editor.selection.active, '');
        },
        {undoStopBefore: false, undoStopAfter: true});

    // Iterate in while-loop as delete edits can delete brackets and thus
    // change the type of indentation.
    while(selection_indices_covered.size < editor.selections.length) {
        let whitespace_strings = [];
        let selections_to_edit = [];
        for(let i = 0; i < editor.selections.length; ++i) {
            if (!selection_indices_covered.has(i)) {
                let indentation_position = findIndentationPositionOfPreviousOpenBracket(editor, editor.selections[i].start);
                if (indentation_position === null) {
                    var defaultIndentationPosition = findDefaultIndentationPosition(editor, editor.selections[i].start);
                    var whitespace = indentationWhitespaceToColumn(defaultIndentationPosition, editor.options.tabSize as number,
                                                                editor.options.insertSpaces as boolean);
                    whitespace_strings.push('\n' + whitespace);
                    selections_to_edit.push(editor.selections[i]);
                    selection_indices_covered.add(i);
                }
            }
        }
        // First perform all edits that are according to default indentation rules.
        await performInsertEditWithWorkingRedo(editor, selections_to_edit,
                                               whitespace_strings);

        // If-clause is optimization to avoid second await.
        if(selection_indices_covered.size < editor.selections.length) {
            whitespace_strings = [];
            selections_to_edit = [];
            for(let i = 0; i < editor.selections.length; ++i) {
                if (!selection_indices_covered.has(i)) {
                    let indentation_position = findIndentationPositionOfPreviousOpenBracket(editor, editor.selections[i].start);
                    if (indentation_position !== null) {
                        var whitespace = indentationWhitespaceToColumn(indentation_position, editor.options.tabSize as number,
                                                                    editor.options.insertSpaces as boolean);
                        whitespace_strings.push('\n' + whitespace);
                        selections_to_edit.push(editor.selections[i]);
                        selection_indices_covered.add(i);
                    }
                }
            }
            // Secondly perform all edits that are according to bracket indentation rules.
            await performInsertEditWithWorkingRedo(editor, selections_to_edit,
                                                   whitespace_strings);
        }
    }

    // Write undo history.
    await editorEdit(
        editor, (edit: vscode.TextEditorEdit) => {
            edit.insert(editor.selection.active, '');
        },
        {undoStopBefore: true, undoStopAfter: false});
}

// this method is called when your extension is deactivated
export function deactivate() {
}
