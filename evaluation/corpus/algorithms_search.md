# Searching a sequence
Linear search checks entries one by one and works on unsorted sequences. Its worst-case
time is O(n). Binary search repeatedly halves a sorted search interval and has
worst-case time O(log n) with constant-time random access. Sorted input is essential:
using binary search on an unsorted list does not reliably find an existing value.
For a small unsorted list, linear search can avoid the cost of sorting first. For
repeated queries on a sorted array, binary search usually examines fewer entries.
