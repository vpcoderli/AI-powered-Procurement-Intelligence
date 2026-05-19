from apsi_crawler.normalizers.bids import normalize_sam_gov_opportunity


def test_normalize_sam_gov_opportunity():
    raw = {
        "noticeId": "abc-123",
        "title": "Enterprise Cloud Migration Services",
        "solicitationNumber": "DOD-CLOUD-2026",
        "department": "DEPARTMENT OF DEFENSE",
        "postedDate": "2026-05-01",
        "responseDeadLine": "2026-06-15T17:00:00-05:00",
        "uiLink": "https://sam.gov/opp/abc-123/view",
        "type": "Solicitation",
    }

    bid = normalize_sam_gov_opportunity(raw)

    assert bid["source"] == "SAM.gov"
    assert bid["source_bid_id"] == "abc-123"
    assert bid["title"] == "Enterprise Cloud Migration Services"
    assert bid["issuer_type"] == "federal"
    assert bid["state_code"] == "US"
    assert bid["source_url"] == "https://sam.gov/opp/abc-123/view"
