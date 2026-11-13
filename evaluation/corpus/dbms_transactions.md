# Database transactions and ACID
A transaction groups database operations into a single unit. ACID means atomicity,
consistency, isolation, and durability. Atomicity requires either all operations to
commit or all to roll back. A bank transfer must not debit one account without
crediting the other. Consistency preserves declared database constraints. Isolation
controls interference between concurrent transactions. Durability means committed
changes survive a crash. Logging supports recovery. Transaction guarantees concern
execution and recovery; they do not remove duplicated fields from a table design.
