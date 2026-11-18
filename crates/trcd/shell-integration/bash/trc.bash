# TRC shell integration for bash (US-5.1, D-55). The holder starts bash 4 and
# later with --posix and ENV naming this file, and bash 3.2 with --rcfile, so
# this runs before any startup file; it runs the startup files bash would have
# run, then marks each prompt and command with OSC 133 and reports the working
# folder with OSC 7. It changes no file, and marks never make TRC act (SEC-06).

if [ -n "${TRC_BASH_INJECT-}" ]; then
    __trc_mode=$TRC_BASH_INJECT
    __trc_login=${TRC_BASH_LOGIN-}
    builtin unset TRC_BASH_INJECT TRC_BASH_LOGIN
    if [ "$__trc_mode" = posix ]; then
        builtin unset ENV
        if [ -n "${TRC_BASH_ENV-}" ]; then
            builtin export ENV="$TRC_BASH_ENV"
        fi
        builtin unset TRC_BASH_ENV
        builtin set +o posix
        if [ "${HISTFILE-}" = "$HOME/.sh_history" ]; then
            HISTFILE="$HOME/.bash_history"
        fi
        if builtin shopt -q login_shell; then
            __trc_login=1
        fi
    fi
    if [ -n "$__trc_login" ]; then
        if [ -r /etc/profile ]; then
            builtin source /etc/profile
        fi
        for __trc_rc in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
            if [ -r "$__trc_rc" ]; then
                builtin source "$__trc_rc"
                break
            fi
        done
    else
        if [ "$__trc_mode" = posix ]; then
            for __trc_rc in /etc/bash.bashrc /etc/bash/bashrc; do
                if [ -r "$__trc_rc" ]; then
                    builtin source "$__trc_rc"
                    break
                fi
            done
        fi
        if [ -r "$HOME/.bashrc" ]; then
            builtin source "$HOME/.bashrc"
        fi
    fi
    builtin unset __trc_rc __trc_mode __trc_login
fi
builtin unset TRC_SHELL_INTEGRATION_DIR

if [[ $- == *i* && -z "${__trc_hooked-}" ]]; then
    __trc_hooked=1
    __trc_status=0
    __trc_ready=

    __trc_url() {
        local LC_ALL=C path=$1 out= c i
        for ((i = 0; i < ${#path}; i++)); do
            c=${path:i:1}
            case $c in
            [a-zA-Z0-9/._~-]) out+=$c ;;
            *)
                printf -v c '%%%02X' "'$c"
                out+=$c
                ;;
            esac
        done
        __trc_reply=$out
    }

    __trc_prompt_start() {
        __trc_status=$?
        __trc_ready=
        return "$__trc_status"
    }

    __trc_prompt_end() {
        printf '\033]133;D;%s\007' "$__trc_status"
        __trc_url "$PWD"
        printf '\033]7;file://%s%s\007' "${HOSTNAME-}" "$__trc_reply"
        printf '\033]133;A\007'
        case $PS1 in
        *'\[\e]133;B\a\]') ;;
        *) PS1=$PS1'\[\e]133;B\a\]' ;;
        esac
        __trc_ready=1
        return "$__trc_status"
    }

    __trc_command_start() {
        if [[ -n $__trc_ready && $BASH_COMMAND != __trc_prompt_start* ]]; then
            __trc_ready=
            printf '\033]133;C\007'
        fi
    }

    if [[ "$(builtin declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
        PROMPT_COMMAND=(__trc_prompt_start "${PROMPT_COMMAND[@]}" __trc_prompt_end)
    else
        PROMPT_COMMAND=$'__trc_prompt_start\n'"${PROMPT_COMMAND-}"$'\n__trc_prompt_end'
    fi
    if ((BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4))); then
        PS0=${PS0-}'$(__trc_ready=; printf "\033]133;C\007")'
    else
        __trc_trap=$(builtin trap -p DEBUG)
        __trc_trap=${__trc_trap#trap -- \'}
        __trc_trap=${__trc_trap%\' DEBUG}
        if [[ -n $__trc_trap ]]; then
            builtin trap "__trc_command_start; $__trc_trap" DEBUG
        else
            builtin trap __trc_command_start DEBUG
        fi
        builtin unset __trc_trap
    fi
fi
