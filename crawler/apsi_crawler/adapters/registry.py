"""适配器注册表。

解析顺序:先查 source_id 的专用适配器,再按 provider_family 取平台适配器,
都未命中则显式抛错。绝不静默跳过——2000 源规模下静默跳过会让你无法
察觉哪些源没有在运行。
"""

from apsi_crawler.spiders.ca_caleprocure import fetch_ca_caleprocure_opportunities
from apsi_crawler.spiders.co_bidnet import fetch_bidnet_opportunities
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
from apsi_crawler.spiders.generic_state import fetch_generic_state_opportunities
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities


class AdapterNotFoundError(Exception):
    pass


# 商业平台:一个适配器服务 N 个租户。阶段 3 在此追加 bonfire / ionwave 等。
PLATFORM_ADAPTERS = {
    "bidnet": fetch_bidnet_opportunities,
    "generic": fetch_generic_state_opportunities,
}

# 自建门户:一源一适配器,仅大型行政区值得。
DEDICATED_ADAPTERS = {
    "ca_caleprocure": fetch_ca_caleprocure_opportunities,
    "tx_esbd": fetch_tx_esbd_opportunities,
    "ny_contract_reporter": fetch_ny_contract_reporter_opportunities,
    "fl_mfmp": fetch_fl_mfmp_opportunities,
    "il_bidbuy": fetch_il_bidbuy_opportunities,
}


def resolve_adapter(source_id, provider_family):
    dedicated = DEDICATED_ADAPTERS.get(source_id)
    if dedicated is not None:
        return dedicated

    if provider_family:
        platform = PLATFORM_ADAPTERS.get(provider_family)
        if platform is not None:
            return platform

    raise AdapterNotFoundError(
        f"No adapter for source_id={source_id!r} provider_family={provider_family!r}"
    )
