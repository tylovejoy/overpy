# =====================================================================
#  OverPy Language Server — Feature Showcase
# =====================================================================
#  This file demonstrates every capability added to the OverPy LSP.
#  Each section is annotated with the feature it exercises and how to
#  try it inside VS Code. The whole file compiles cleanly, so the
#  "diagnostics" provider should report zero problems.
#
#  Providers advertised by the server (src/languageServer/server.ts):
#    completions · signature help · hover · semantic tokens
#    document symbols · inlay hints · folding ranges · code actions
#    go-to-definition · find references · rename · diagnostics
# =====================================================================

# --- Preprocessing directives -----------------------------------------
#  COMPLETIONS: type `#!` on a blank line to get directive suggestions
#  (define, suppressWarnings, mainFile, ...). DIAGNOSTICS: a bad
#  directive would surface a red squiggle here.
#!suppressWarnings w_unused_variable
#!define PI 3.14159

# --- #!define macro ---------------------------------------------------
#  DOCUMENT SYMBOLS: appears in the outline as a Constant ("define").
#  GO-TO-DEFINITION / REFERENCES: Ctrl-Click MAX_SCORE below jumps here.
#  Note: directive lines are intentionally NOT treated as hover docs.
#!define MAX_SCORE 20

settings {
    "main": {
        "modeName": "LSP Feature Showcase",
        "description": "Every OverPy language-server feature in one file"
    },
    "gamemodes": {
        "skirmish": {
            "enabledMaps": [
                "workshopIsland"
            ]
        }
    }
}

# =====================================================================
#  DECLARATIONS — exercise document symbols, comment-doc hover,
#  go-to-definition, find-references and rename.
# =====================================================================

# COMMENT DOCS (trailing form): hover `score` anywhere to read this.
globalvar score # The team's running score for the round

# COMMENT DOCS (preceding-block form): the contiguous comment lines
# directly above a declaration become its hover documentation.
# Charge accumulated toward the player's ultimate ability.
playervar ultCharge

# Tracks which phase of the match we are in (see the GameStatus enum).
globalvar gameStatus

# Value macro. SEMANTIC TOKENS colour it as a macro; HOVER shows its
# body; GO-TO-DEFINITION / RENAME (F2) work on every use site.
macro SCORE_STEP = 1

# Function-style macro — try RENAME on `bonus`, or hover a call site.
macro bonus(base):
    base * SCORE_STEP + 1

# CUSTOM ENUM. DOCUMENT SYMBOLS lists it (and folds its body).
# COMPLETIONS: typing `GameStatus.` offers the members below, each
# carrying its own comment-doc. HOVER on `GameStatus` shows the enum.
enum GameStatus:
    # Players are still filing in before the match starts.
    SETUP = 0
    PLAYING = 1 # The match is currently live (trailing comment doc)
    FINISHED = 2

# SUBROUTINE: declared up front, defined further down. Both the
# declaration and the `def` participate in go-to-definition/rename.
subroutine resetScore

# =====================================================================
#  SUBROUTINE DEFINITION
#  FOLDING RANGE + DOCUMENT SYMBOL (Function, "def"). COMMENT DOC on
#  the def line is surfaced on hover at every call site.
# =====================================================================
def resetScore(): # Reset the round score back to zero
    @Name "reset score"
    score = 0

# =====================================================================
#  RULE — the main place the rich providers light up.
# =====================================================================
rule "Showcase interactions":
    # COMPLETIONS: typing `@` offers rule annotations (@Event, @Condition…).
    # HOVER on @Event shows annotation docs. SEMANTIC TOKENS: decorator.
    @Event eachPlayer

    # SIGNATURE HELP fires inside the parens of isHoldingButton().
    # TYPE-AWARE ARG COMPLETION: after the `(` the Button.* members are
    # hoisted to the top because the parameter is typed `Button`.
    # INLAY HINTS: a `button:` hint renders before the argument; the
    # implicit `self` (player) parameter is correctly suppressed.
    @Condition eventPlayer.isHoldingButton(Button.INTERACT)

    # GO-TO-DEFINITION on any of these symbols jumps to its declaration.
    # FIND-REFERENCES (Shift-F12) gathers every use across the file.
    score += SCORE_STEP            # macro + globalvar
    score = bonus(score)           # function macro
    score = min(score, MAX_SCORE)  # #!define + builtin (signature help)
    gameStatus = GameStatus.PLAYING  # enum member → go-to-def / rename

    # INLAY HINTS show `time:` and `waitBehavior:` before the positional
    # args. TYPE-AWARE COMPLETION offers Wait.* for the 2nd argument.
    # HOVER over `wait` shows its full signature and parameter docs.
    wait(1, Wait.IGNORE_CONDITION)

    # Player variable write (qualified). REFERENCES on `ultCharge`
    # understands the qualified/unqualified distinction from globals.
    eventPlayer.ultCharge += bonus(1)

    # Enum member reference — GO-TO-DEFINITION lands on FINISHED inside
    # the enum block; RENAME updates the member and every qualified use.
    if score >= MAX_SCORE and gameStatus != GameStatus.FINISHED:
        gameStatus = GameStatus.FINISHED
        resetScore()               # subroutine call → def resetScore()

    # HOVER on getFacingDirection() shows `Player.getFacingDirection()
    # -> Direction`. SEMANTIC TOKENS classify it as a method.
    eventPlayer.startForcingPosition(
        eventPlayer.getPosition() + eventPlayer.getFacingDirection() * 2,
        false
    )
    wait(0.25, Wait.IGNORE_CONDITION)
    eventPlayer.stopForcingPosition()

rule "Showcase display":
    @Event eachPlayer
    # STRING ENTITY COMPLETION: inside a string, typing `\&` suggests
    # named entities. Texture/Color enums get member completion + hover.
    smallMessage(
        eventPlayer,
        f"{Texture.ASSAULT} Score: <fg00FFFFFF>{score}</fg> / {MAX_SCORE}"
    )
    # DIAGNOSTICS: this whole file is valid OverPy, so the Problems
    # panel stays empty — flip any token to something invalid to watch
    # the compiler-driven squiggles appear in real time.
    wait(0.5, Wait.IGNORE_CONDITION)
