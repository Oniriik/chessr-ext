#!/usr/bin/expect -f

set timeout 30
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 {*}$argv

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        interact
    }
    eof {
        exit
    }
}
