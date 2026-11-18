# TRC shell integration for fish (US-5.1, D-55). The holder adds this folder's
# parent to XDG_DATA_DIRS, so fish reads this file before config.fish; it puts
# XDG_DATA_DIRS back, and on fish 3, which marks nothing itself, marks each
# prompt and command with OSC 133 and reports the working folder with OSC 7.
# fish 4 does both on its own. Marks never make TRC act (SEC-06).

if set -q TRC_FISH_XDG_DIR
    set -l kept
    for dir in (string split : -- "$XDG_DATA_DIRS")
        if test "$dir" != "$TRC_FISH_XDG_DIR"
            set -a kept $dir
        end
    end
    if set -q TRC_FISH_XDG_UNSET
        set -e XDG_DATA_DIRS
    else
        set -gx XDG_DATA_DIRS (string join : -- $kept)
    end
    set -e TRC_FISH_XDG_DIR
    set -e TRC_FISH_XDG_UNSET
end
set -e TRC_SHELL_INTEGRATION_DIR

if status is-interactive; and not set -q __trc_hooked; and test (string split . -- $version)[1] -lt 4
    set -g __trc_hooked 1

    function __trc_prompt --on-event fish_prompt
        if set -q __trc_executing
            printf '\e]133;D;%s\a' $__trc_status
            set -e __trc_executing
        end
        printf '\e]7;file://%s%s\a' $hostname (string escape --style=url -- $PWD)
        printf '\e]133;A\a'
    end

    function __trc_command --on-event fish_preexec
        set -g __trc_executing 1
        printf '\e]133;C\a'
    end

    function __trc_status --on-event fish_postexec
        set -g __trc_status $status
    end
end
