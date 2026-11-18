# TRC shell integration hooks for zsh (US-5.1, D-55): OSC 133 marks for each
# prompt and command, and OSC 7 for the working folder. The hooks go in at the
# first prompt, after the user's .zshrc, so they run after a theme's own and
# see the prompt it draws. Marks never make TRC act (SEC-06).

(( ${+__trc_hooked} )) && builtin return
builtin typeset -g __trc_hooked=1 __trc_executing=
builtin autoload -Uz add-zsh-hook

__trc_url() {
    builtin emulate -L zsh
    builtin local LC_ALL=C dir=$1 out= c
    builtin local -i i
    for (( i = 1; i <= ${#dir}; i++ )); do
        c=${dir[i]}
        case $c in
            [a-zA-Z0-9/._~-]) out+=$c ;;
            *) builtin printf -v c '%%%02X' "'$c"; out+=$c ;;
        esac
    done
    REPLY=$out
}

__trc_precmd() {
    builtin local ret=$?
    if [[ -n $__trc_executing ]]; then
        builtin printf '\e]133;D;%s\a' $ret
        __trc_executing=
    fi
    __trc_url "$PWD"
    builtin printf '\e]7;file://%s%s\a' "$HOST" "$REPLY"
    builtin printf '\e]133;A\a'
    [[ $PS1 == *$'%{\e]133;B\a%}' ]] || PS1=$PS1$'%{\e]133;B\a%}'
    builtin return $ret
}

__trc_preexec() {
    __trc_executing=1
    builtin printf '\e]133;C\a'
}

__trc_install() {
    add-zsh-hook -d precmd __trc_install
    add-zsh-hook precmd __trc_precmd
    add-zsh-hook preexec __trc_preexec
    __trc_precmd
}

add-zsh-hook precmd __trc_install
