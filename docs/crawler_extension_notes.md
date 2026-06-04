# PwnyHub Crawler Extension Notes

This note is for future PwnyHub crawler design work. It is intentionally a placeholder/design document, not an implementation.

The crawler should remain integrated with PwnyHub's project model:

```text
Project Policy Profile / ROE
  -> scope allow/deny
  -> asset tier / no-bounty / out-of-scope policy
  -> network limits and QPS
  -> authenticated test-account context when explicitly provided
  -> crawler source output
  -> actions/risk/p