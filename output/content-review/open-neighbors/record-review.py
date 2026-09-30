import json
from pathlib import Path

SRC = Path('content/batch-002/sources')


def record(selected, excluded, reviewed):
    cp = SRC / 'neighbor-captions.json'
    rp = SRC / 'neighbor-review.json'
    captions = json.loads(cp.read_text()) if cp.exists() else {}
    review = json.loads(rp.read_text()) if rp.exists() else {'reviewedPageids': [], 'exclusions': []}
    for pid, fields in selected.items():
        title, caption, group, animal_type = fields
        captions[str(pid)] = {
            'title': title,
            'caption': caption,
            'group': group,
            'topics': ['治愈瞬间', '陪伴日常'],
            'circleId': ('circle-birds' if group == 'birds' else
                         'circle-aquatics' if group in ['fish', 'shrimp', 'snails', 'aquarium'] else
                         'circle-exotics' if animal_type in ['reptile', 'amphibian'] else
                         'circle-small-pets' if animal_type in ['rabbit', 'small-mammal'] else
                         'circle-neighbors'),
            'animalTypes': [animal_type],
        }
    review['reviewedPageids'] = list(dict.fromkeys(review['reviewedPageids'] + reviewed))
    exclude_map = {e['pageid']: e for e in review['exclusions']}
    for pid, reason in excluded.items():
        exclude_map[pid] = {'pageid': pid, 'reason': reason}
    review['exclusions'] = list(exclude_map.values())
    assert not set(captions) & {str(e['pageid']) for e in review['exclusions']}
    cp.write_text(json.dumps(captions, ensure_ascii=False, indent=2) + '\n')
    rp.write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
    print({'reviewed': len(review['reviewedPageids']), 'accepted': len(captions), 'excluded': len(review['exclusions'])})
