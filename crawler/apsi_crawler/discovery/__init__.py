"""Read-only discovery of candidate sources from a platform's own public agency directory.

One harvester per platform. Each returns `{"agencies": [...], "stats": {...}}` and never writes
anything — registration stays behind the existing human approval gate.
"""

from apsi_crawler.discovery.bidnet import harvest_bidnet


HARVESTERS = {"bidnet": harvest_bidnet}

__all__ = ["HARVESTERS", "harvest_bidnet"]
