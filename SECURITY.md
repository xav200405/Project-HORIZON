# Security Policy

## Supported Scope

Security reports should focus on the Raspberry Pi RMS, account management,
telemetry storage, command endpoints, and deployment configuration.

## Default Credentials

Fresh RMS databases create this default admin account:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |

Change this account before field use. Do not expose the RMS to untrusted
networks while default credentials are active.

## Sensitive Files

Do not commit:

- `.env`
- TLS private keys or certificates
- SQLite databases
- telemetry exports that contain sensitive flight data
- Wi-Fi credentials
- serial logs from private test flights

## Reporting Issues

Use a private reporting channel if the repository host supports one. If not,
open a minimal issue that says a security report is available without posting
exploit details, credentials, private telemetry, or vehicle-identifying data.
