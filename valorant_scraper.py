import cloudscraper
from bs4 import BeautifulSoup
import re
import json
import sys

def scrape_valorant_stats(riot_id):
    """
    Scrapes Valorant statistics from Tracker.gg for a given Riot ID (name#tag).
    Returns a dictionary of stats or an error message.
    """
    try:
        # 1. Prepare the URL
        if '#' not in riot_id:
            return {"error": "Invalid Riot ID format. Use Name#Tag."}
        
        name, tag = riot_id.split('#')
        url = f"https://tracker.gg/valorant/profile/riot/{name}%23{tag}/overview"
        
        # 2. Setup Scraper (Bypass Cloudflare)
        scraper = cloudscraper.create_scraper(
            browser={
                'browser': 'chrome',
                'platform': 'windows',
                'desktop': True
            }
        )
        
        # 3. Fetch Data
        response = scraper.get(url)
        
        if response.status_code == 404:
            return {"error": "Player not found. Check Name#Tag and ensure profile is public."}
        
        if "This profile is private" in response.text:
            return {"error": "This profile is private. Please sign in to Tracker.gg and make it public."}
        
        soup = BeautifulSoup(response.text, 'html.parser')

        # 4. Parse Stats
        stats = {
            "riot_id": riot_id,
            "rank": "Unranked",
            "rank_numeric": 0,
            "kd_ratio": 0.0,
            "win_rate": 0.0,
            "hs_rate": 0.0,
            "top_agents": []
        }

        # --- RANK ---
        rank_val = soup.select_one('.rank-name')
        if rank_val:
            stats["rank"] = rank_val.get_text(strip=True)
            # Numeric mapping (simplification)
            rank_map = {
                "Iron 1": 1, "Iron 2": 2, "Iron 3": 3,
                "Bronze 1": 4, "Bronze 2": 5, "Bronze 3": 6,
                "Silver 1": 7, "Silver 2": 8, "Silver 3": 9,
                "Gold 1": 10, "Gold 2": 11, "Gold 3": 12,
                "Platinum 1": 13, "Platinum 2": 14, "Platinum 3": 15,
                "Diamond 1": 16, "Diamond 2": 17, "Diamond 3": 18,
                "Ascendant 1": 19, "Ascendant 2": 20, "Ascendant 3": 21,
                "Immortal 1": 22, "Immortal 2": 23, "Immortal 3": 24,
                "Radiant": 25
            }
            stats["rank_numeric"] = rank_map.get(stats["rank"], 0)

        # --- K/D, WIN%, HS% ---
        # Tracker.gg usually puts these in .numbers classes
        # This is a bit brittle, using regex search on text is often safer
        nums = soup.select('.numbers .value')
        if len(nums) >= 3:
            try:
                # Based on typical layout: K/D, Win%, HS%
                stats["kd_ratio"] = float(nums[0].get_text().replace(',', ''))
                stats["win_rate"] = float(nums[1].get_text().replace('%', '').replace(',', ''))
                stats["hs_rate"] = float(nums[2].get_text().replace('%', '').replace(',', ''))
            except: pass

        # --- TOP AGENTS ---
        agents = soup.select('.top-agents__agent-name')
        for agent in agents[:3]:
            stats["top_agents"].append(agent.get_text(strip=True))

        return stats

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No Riot ID provided."}))
    else:
        result = scrape_valorant_stats(sys.argv[1])
        print(json.dumps(result, indent=2))
