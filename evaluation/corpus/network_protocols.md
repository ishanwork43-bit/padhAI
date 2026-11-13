# Network transport and naming
TCP provides a reliable, ordered byte stream with acknowledgments and retransmission.
UDP sends independent datagrams without guaranteeing delivery or ordering. Applications
that prioritize low latency, such as live voice, may use UDP and handle loss themselves.
DNS translates a domain name into records such as an IP address. A DNS lookup happens
before a client can contact a server by its address. DNS is a naming service, whereas
TCP and UDP are transport protocols. These notes do not describe cryptographic methods.
