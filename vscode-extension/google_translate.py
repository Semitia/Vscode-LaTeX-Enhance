"""Small standard-library client for Google's keyless web translation service."""
import json
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request


def translate(payload):
    text = payload.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 5000:
        raise ValueError('请选择不超过 5000 字符的文字。')
    params = urllib.parse.urlencode({
        'client': 'gtx', 'sl': 'auto', 'tl': payload.get('target', 'zh-CN'),
        'dt': 't', 'q': text,
    })
    request = urllib.request.Request(
        'https://translate.googleapis.com/translate_a/single?' + params,
        headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'},
    )
    proxy = payload.get('proxy', '')
    if proxy:
        if urllib.parse.urlparse(proxy).scheme not in ('http', 'https'):
            raise ValueError('翻译代理需要使用 http:// 或 https:// 地址。')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({'http': proxy, 'https': proxy}))
    else:
        opener = urllib.request.build_opener()
    with opener.open(request, timeout=8) as response:
        body = response.read(262145)
    if len(body) > 262144:
        raise ValueError('Google 翻译返回内容过长。')
    data = json.loads(body)
    if not isinstance(data, list) or not data or not isinstance(data[0], list):
        raise ValueError('Google 翻译返回格式发生变化。')
    result = ''.join(segment[0] for segment in data[0]
                     if isinstance(segment, list) and segment and isinstance(segment[0], str))
    if not result.strip():
        raise ValueError('Google 未返回译文。')
    return {'translation': result, 'detectedSource': data[2] if len(data) > 2 and isinstance(data[2], str) else ''}


def main():
    try:
        payload = json.loads(sys.stdin.read(65536))
        result = {'ok': True, **translate(payload)}
    except urllib.error.HTTPError as error:
        message = ('Google 请求过于频繁，请稍后重选文字。' if error.code == 429
                   else 'Google 翻译请求失败（HTTP %s），请检查网络或代理。' % error.code)
        result = {'ok': False, 'message': message}
    except (TimeoutError, socket.timeout):
        result = {'ok': False, 'message': 'Google 翻译超时，请检查网络或代理。'}
    except urllib.error.URLError:
        result = {'ok': False, 'message': '无法连接 Google 翻译，请检查网络或代理。'}
    except (ValueError, TypeError, KeyError):
        result = {'ok': False, 'message': 'Google 翻译未返回有效译文，请稍后重试。'}
    except Exception:
        result = {'ok': False, 'message': 'Google 翻译请求失败，请稍后重试。'}
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
