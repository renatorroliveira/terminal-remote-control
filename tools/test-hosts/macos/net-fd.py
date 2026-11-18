"""Starts a tart VM on lima's user-mode network (P-67, D-53).

Makes a datagram socket pair, hands one end to `limactl usernet` over its control socket as SCM_RIGHTS, and starts
`tart run --no-graphics --net-fd=3 <vm>` in a session of its own with the other end as descriptor 3.
Usage: python3 -I net-fd.py <usernet socket> <tart> <vm> <log>
"""

import os
import socket
import subprocess
import sys


def main() -> None:
    """Connects the VM's network to usernet and starts the VM."""
    listen, tart, vm, log = sys.argv[1:5]
    machine, network = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
    control = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    control.connect(listen)
    socket.send_fds(control, [b"\0"], [network.fileno()])
    os.dup2(machine.fileno(), 3)
    with open(log, "w", encoding="utf-8") as output:
        subprocess.Popen(
            [tart, "run", "--no-graphics", "--net-fd=3", vm],
            pass_fds=(3,),
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.STDOUT,
        )


if __name__ == "__main__":
    main()
