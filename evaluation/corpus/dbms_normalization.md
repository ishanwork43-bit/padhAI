# Relational database normalization
Normalization organizes relational tables to reduce duplicated data and update anomalies.
First normal form (1NF) requires atomic values in each field, without repeating groups.
Second normal form (2NF) removes partial dependencies on part of a composite key.
Third normal form (3NF) removes transitive dependencies between non-key attributes.
For example, a student address repeated in many enrollment rows should be stored once
in a student table and referenced through a student identifier. This reduces the
risk of changing one address copy while leaving another copy outdated.
