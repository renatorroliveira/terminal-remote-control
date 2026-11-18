# TRC shell integration for zsh (US-5.1, D-55). The holder points ZDOTDIR here,
# so zsh reads this file first: it gives the user's ZDOTDIR back, runs their own
# .zshenv, and loads the hooks into interactive shells. zsh then reads the
# user's other startup files from their ZDOTDIR as usual. It changes no file.

if [[ -n "${TRC_ZSH_ZDOTDIR+X}" ]]; then
    builtin export ZDOTDIR="$TRC_ZSH_ZDOTDIR"
    builtin unset TRC_ZSH_ZDOTDIR
else
    builtin unset ZDOTDIR
fi

{
    builtin typeset __trc_zshenv="${ZDOTDIR-$HOME}/.zshenv"
    [[ ! -r "$__trc_zshenv" ]] || builtin source -- "$__trc_zshenv"
} always {
    if [[ -o interactive && -n "${TRC_SHELL_INTEGRATION_DIR-}" ]]; then
        builtin source -- "$TRC_SHELL_INTEGRATION_DIR/zsh/trc-integration.zsh"
    fi
    builtin unset __trc_zshenv TRC_SHELL_INTEGRATION_DIR
}
