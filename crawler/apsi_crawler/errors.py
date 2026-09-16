"""Cross-module crawler errors.

Lives outside `spiders/` and `adapters/` so the list stage, the adapters and the CLI can all
raise/catch the same class without importing each other.
"""


class VerifiedEmptyListError(Exception):
    """The list page loaded fine and explicitly says it has nothing open right now.

    This is NOT a parser failure. `fetch_task` turns it into a zero-row success — but only
    when `tenant_confirmed` is true, i.e. the page also proves it is the tenant we asked for.
    An unconfirmed empty phrase (a 404 shell, a wrong tenant, a search chrome string) stays a
    failure, otherwise a genuinely broken source would quietly look healthy forever.
    """

    def __init__(self, marker, tenant_confirmed, method="adapter", message=None):
        super().__init__(
            message
            or "list page reports an empty result ({0}; tenant_confirmed={1})".format(marker, tenant_confirmed)
        )
        self.marker = marker
        self.tenant_confirmed = bool(tenant_confirmed)
        self.method = method

    def as_metadata(self):
        """The `metadata.emptyState` object from contract C1."""
        return {
            "verified": True,
            "marker": self.marker,
            "tenant_confirmed": self.tenant_confirmed,
            "method": self.method,
        }
