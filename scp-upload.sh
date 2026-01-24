#!/usr/bin/expect -f

set timeout 60
set local_file [lindex $argv 0]
set remote_path [lindex $argv 1]

spawn scp -o StrictHostKeyChecking=no $local_file ubuntu@135.125.201.246:$remote_path

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
