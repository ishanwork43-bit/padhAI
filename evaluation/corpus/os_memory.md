# Operating system memory management
Virtual memory gives each process its own logical address space. The operating system
maps virtual addresses to physical memory using page tables. Paging divides virtual
memory into fixed-size pages and physical memory into frames. A page fault occurs
when a requested page is not currently available in physical memory and requires OS
handling. Swapping or paging data to disk allows programs to use more virtual memory
than available RAM, but frequent faults can slow execution. Process address-space
isolation helps prevent one process from directly reading another process's memory.
