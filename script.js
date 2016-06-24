nunjucks.configure({ autoescape: true })
var md = new Remarkable()

var parser = document.createElement('a')
parser.href = document.location.href
var path = parser.pathname

var state = {
    userName: path.split('/')[1],
    projectName: path.split('/')[2],
    id: uuid.v4()
}

if(window.location.hash != '') {
    state = JSON.parse(localStorage.getItem(window.location.hash.replace('#','')))
}

var clientId
if(parser.hostname == "localhost") {
    clientId = "8ae9b734b38486dc3d140cb1321cfda7bca5ef061ecb79aee81207cd9e51d859"
} else {
    clientId = "118ee6aceaf7a16c4f8f83536a334233bc2b22e2c6a286ef7a83fa4a2714f328"
}

function getRepo(callback) {
    var url = 'https://api.github.com/repos/'+state.userName+'/'+state.projectName
    if(typeof Cookies.get('GitHubToken') != 'undefined') {
        url = url+'?access_token='+Cookies.get('GitHubToken')
    }
    $.ajax({
        url: url,
        statusCode: {
            403: function() {
                var github_token = prompt("The GitHub API has been called too many times. You can enter a personal access token to have unlimited access.")
                if(github_token != null) {
                    Cookies.set('GitHubToken', github_token)
                }
            }
        },
        success: function(data) {
            callback(data)
        }
    })
}

function getProject(callback) {
    var branch = state.repo.default_branch
    if(typeof path.split('/')[3] != 'undefined') {
        branch = path.split('/')[3]
    }
    $.ajax({
        url: 'https://raw.githubusercontent.com/'+state.userName+'/'+state.projectName+'/'+branch+'/project.json',
        success: function(data) {
            var project = JSON.parse(data)
            project.branch = branch
            callback(project)
        }
    })
}

function renderProject(callback) {
    var baseURL = parser.protocol+"//"+parser.host
    var projectTemplate = $('script[name=project]').text()
    var projectHTML = nunjucks.renderString(projectTemplate, state)

    $('body').append(projectHTML)

    $('button').click(function(e) {
        e.preventDefault()
        if(typeof Cookies.get('AccessToken') == 'undefined') {
            window.open("https://cloud.digitalocean.com/v1/oauth/authorize?response_type=token&client_id="+clientId+"&redirect_uri="+baseURL+"/callback&scope=read+write",
                        "oauth",
                        "menubar=1,resizable=1,width=1100,height=700")
        } else {
            doProject()
        }
        return false
    })

    callback()
}

function getKeys(callback) {
    $.ajax({
        url: 'https://api.digitalocean.com/v2/account/keys',
        beforeSend: function(xhr){xhr.setRequestHeader('Authorization', 'Bearer '+Cookies.get('AccessToken'))},
        success: function(data) {
            callback(data.ssh_keys)
        }
    })
}

function createDroplet(callback) {

    if(typeof state.droplet != 'undefined') {
        callback(state.droplet)
        return
    }

    var formData = $('form').serializeObject()

    var keys = []
    for(var i = 0; i < state.ssh_keys.length; i++) {
        keys[i] = state.ssh_keys[i].id
    }

    var cloudConfig = {
        packages: ["curl"],
        runcmd: [
            "mkdir -p /tmp/dobutton/node",
            "mkdir -p /tmp/dobutton/public",
            "echo '{\"status\":\"installing\"}' >/tmp/dobutton/public/state.json",
            "curl -L https://nodejs.org/download/release/v0.10.45/node-v0.10.45-linux-x64.tar.gz -o /tmp/dobutton/node.tar.gz",
            "tar -xvf /tmp/dobutton/node.tar.gz -C /tmp/dobutton/node --strip-components=1",
            "/tmp/dobutton/node/bin/npm install -g http-server",
            "/tmp/dobutton/node/bin/node /tmp/dobutton/node/lib/node_modules/http-server/bin/http-server /tmp/dobutton/public -p 33333 -c-1 --cors &",
            "curl -L https://raw.githubusercontent.com/"+state.userName+"/"+state.projectName+"/"+state.repo.default_branch+"/"+state.project.provision.script+" -o /tmp/provision.sh",
            "sh /tmp/provision.sh",
            "echo '{\"status\":\"complete\"}' >/tmp/dobutton/public/state.json",
            "sleep 3600; kill -9 $(ps aux | grep -i \"http-server.*33333\" | awk {'print $2'}); rm -rf /tmp/dobutton"
        ]
    } 
    var userData = "#cloud-config\n"+YAML.stringify(cloudConfig)

    var dropletRequestData = {
        name: formData.name,
        region: formData.region,
        size: formData.size,
        image: formData.image,
        ssh_keys: keys,
        user_data: userData 
    }
    $.ajax({
        type: 'POST',
        url: 'https://api.digitalocean.com/v2/droplets',
        data: JSON.stringify(dropletRequestData),
        contentType: 'application/json',
        beforeSend: function(xhr){xhr.setRequestHeader('Authorization', 'Bearer '+Cookies.get('AccessToken'))},
        success: function(data) {
            callback(data.droplet)
        }
    })
}

function waitFor(action, callback) {
    var interval = 5000
    var url = 'https://api.digitalocean.com/v2/droplets/'+state.droplet.id
    var dataType = 'json'
    var beforeSend = function(xhr){
        xhr.setRequestHeader('Authorization', 'Bearer '+Cookies.get('AccessToken'))
    }
    var error = function() {
        setTimeout(checkDroplet, interval)
    }
    var success = function(data) {
        if(data.droplet.status == 'active') {
            var droplet = data.droplet
            droplet.ip = droplet.networks.v4[0].ip_address
            callback(droplet)
        } else {
            setTimeout(checkDroplet, interval)
        }
    }
    if(action == 'provision') {
        url = 'http://'+state.droplet.ip+':33333/state.json'
        dataType = 'text'
        beforeSend = function(xhr){}
        success = function(data) {
            data = JSON.parse(data)
            if(data.status == 'complete') {
                callback(data)
            } else {
                setTimeout(checkDroplet, interval)
            }
        }
    }
    var checkDroplet = function() {
        $.ajax({
            url: url,
            dataType: dataType,
            timeout: 2000,
            beforeSend: beforeSend,
            error: error,
            success: success
        })
    }
    checkDroplet()
}

function parseQuery(qstr) {
    var query = {}
    var a = qstr.substr(1).split('&')
    for (var i = 0; i < a.length; i++) {
        var b = a[i].split('=')
        query[decodeURIComponent(b[0])] = decodeURIComponent(b[1] || '')
    }
    return query
}

function renderComplete() {
    $('button').prop("disabled",false)
    $('button').text("GO!")
    $('button').click(function() {var win = window.open('http://'+state.droplet.networks.v4[0].ip_address, '_blank'); win.focus(); return false})
    $('fieldset').hide()
    if(typeof state.project.provision.complete != 'undefined') {
        $.ajax({
            url: 'https://raw.githubusercontent.com/'+state.userName+'/'+state.projectName+'/'+state.project.branch+'/'+state.project.provision.complete,
            success: function(data) {
                $('.complete').html(nunjucks.renderString(md.render(data), state))
            }
        })
    }
}

function doProject() {
    window.location.hash = state.id 
    localStorage.setItem( state.id, JSON.stringify(state) )

    $('button').off().prop("disabled",true)
    $('button').text("checking for ssh-keys...")

    getKeys(function(ssh_keys) {
        state.ssh_keys = ssh_keys
        if(ssh_keys.length == 0) {
            alert("Your DigitalOcean account must have an active ssh-key.")
        } else {
            $('button').text("creating droplet...")
            createDroplet(function(droplet) {
                state.droplet = droplet
                waitFor('activation', function(droplet) {
                    state.droplet = droplet
                    localStorage.setItem( state.id, JSON.stringify(state) )
                    $('button').text("provisioning droplet...")
                    waitFor('provision', function(provision) {
                        state.project.provision = $.extend({}, state.project.provision, provision)
                        localStorage.setItem(state.id, JSON.stringify(state))
                        renderComplete()
                    })
                })
            })
        }
    })
}

function init(callback) {
    var error = function(result) {
        callback('', result)
    }
    if(typeof state.project == 'undefined') {
        getRepo(function(repo) {
            state.repo = repo
            getProject(function(project) {
                state.project = project
                renderProject(function() {
                    callback(state)
                }, error)
            }, error)
        }, error)
    } else {
        renderProject(function() {
            doProject()
            callback(state)
        }, error)
    }
}

$(function() {
    if(path == "/") {
        var homeTemplate = $('script[name=home]').text()
        var homeHTML = nunjucks.renderString(homeTemplate, {})
        $('body').append(homeHTML)
    }
    else if(path == "/callback") {
        var callback = parseQuery(window.location.hash)
        if(typeof callback.error == 'undefined') {
            Cookies.set( 'AccessToken', callback.access_token )
        } else {

        }
        window.close()
    }
    else {
        init(function(result, err){
            if(err) {
                console.log(err)
            } else {
                console.log(result)
            }
        })
    }
})
