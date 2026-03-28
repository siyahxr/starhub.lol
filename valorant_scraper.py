import cloudscraper
from bs4 import BeautifulSoup
import json
import sys
import re

# --- CONFIGURATION ---
API_BASE = "https://starhub.lol" # Change to your domain

def sync_to_api(user_id, data):
    """
    Sends scraped data to StarHUB API
    """
    import requests
    url = f"{API_BASE}/api/stats/update"
    payload = {
        "user_id": user_id,
        "kd": data['kd'],
        "win_rate": data['win_rate'],
        "hs_rate": data['hs_rate'],
        "rank_numeric": data['rank_numeric'],
        "top_agents": data['top_agents']
    }
    try:
        r = requests.post(url, json=payload)
        if r.ok:
            print(f"✅ Success: Synced {user_id} to StarHUB.")
        else:
            print(f"❌ Error {r.status_code}: {r.text}")
    except Exception as e:
        print(f"❌ Sync Failed: {str(e)}")

def scrape_tracker(riot_id, user_id=None):
    """
    Scrapes Valorant stats from tracker.gg
    Format: Nick#Tag
    """
    try:
        if '#' not in riot_id:
            return {"error": "Invalid Riot ID format. Use Nick#Tag"}
        
        name, tag = riot_id.split('#')
        url = f"https://tracker.gg/valorant/profile/riot/{name}%23{tag}/overview"
        
        # Use cloudscraper to bypass Cloudflare
        scraper = cloudscraper.create_scraper(
            browser={
                'browser': 'chrome',
                'platform': 'windows',
                'desktop': True
            }
        )
        
        response = scraper.get(url)
        if response.status_code == 404:
            return {"error": "Profile not found or private."}
        if response.status_code != 200:
            return {"error": f"Tracker.gg returned status {response.status_code}"}

        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 1. Rank Extraction
        rank_div = soup.select_one('.valorant-ranked-bg .rank-name')
        rank_text = rank_div.get_text(strip=True) if rank_div else "Unranked"
        
        # 2. Key Stats (K/D, Win%, HS%)
        stats = {}
        main_stats = soup.select('.main-stats .stat')
        for stat in main_stats:
            val_el = stat.select_one('.value')
            name_el = stat.select_one('.name')
            if val_el and name_el:
                label = name_el.get_text(strip=True).lower()
                value = val_el.get_text(strip=True)
                stats[label] = value

        # 3. Top 3 Agents
        agents = []
        agent_rows = soup.select('.top-agents__agent')[:3]
        for row in agent_rows:
            agent_name = row.select_one('.name').get_text(strip=True)
            agents.append(agent_name)

        # 4. Numeric Rank Mapping
        rank_map = {
            "Iron": 1, "Bronze": 4, "Silver": 7, "Gold": 10, 
            "Platinum": 13, "Diamond": 16, "Ascendant": 19, 
            "Immortal": 22, "Radiant": 25, "Unranked": 0
        }
        
        base_rank = rank_text.split(' ')[0] if ' ' in rank_text else rank_text
        tier = 1
        matches = re.search(r' (\d)', rank_text)
        if matches:
            tier = int(matches.group(1))
        
        rank_numeric = rank_map.get(base_rank, 0)
        if rank_numeric > 0 and base_rank != "Radiant":
            rank_numeric += (tier - 1)

        result = {
            "riot_id": riot_id,
            "rank": rank_text,
            "rank_numeric": rank_numeric,
            "kd": stats.get('k/d ratio', '0.00'),
            "win_rate": stats.get('win %', '0.0%'),
            "hs_rate": stats.get('headshot %', '0.0%'),
            "top_agents": agents,
            "status": "success"
        }
        
        if user_id:
            sync_to_api(user_id, result)

        return result

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import time
    import random

    # Usage: python valorant_scraper.py --auto
    # OR:    python valorant_scraper.py Nick#Tag [user_id]
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--auto":
            print("🚀 StarHUB Autonomous Scraper started...")
            print(f"📡 API Base: {API_BASE}")
            
            while True:
                try:
                    print("\n🔍 Fetching player list from database...")
                    r = requests.get(f"{API_BASE}/api/sync/list")
                    if r.ok:
                        players = r.json()
                        print(f"📦 Found {len(players)} players to sync.")
                        
                        for p in players:
                            riot_id = f"{p['riot_name']}#{p['riot_tag']}"
                            user_id = p['user_id']
                            
                            print(f"\n⚡ Syncing: {riot_id} ({p['username']})")
                            scrape_tracker(riot_id, user_id)
                            
                            # Anti-ban delay
                            delay = random.randint(30, 60)
                            print(f"⏳ Sleeping {delay}s to avoid Tracker.gg bans...")
                            time.sleep(delay)
                    else:
                        print(f"❌ Could not fetch player list: {r.status_code}")
                except Exception as e:
                    print(f"🚨 Loop Error: {str(e)}")
                
                print("\n🏁 Full cycle complete. Waiting 10 minutes before next sync...")
                time.sleep(600) # 10 minutes
        else:
            riot_id = sys.argv[1]
            user_id = sys.argv[2] if len(sys.argv) > 2 else None
            print(json.dumps(scrape_tracker(riot_id, user_id), indent=2))
    else:
        print("Usage:")
        print("  Auto Sync: python valorant_scraper.py --auto")
        print("  Manual:    python valorant_scraper.py Nick#Tag [user_id]")
