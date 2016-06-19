nunjucks.configure({ autoescape: true })
var md = new Remarkable()

var parser = document.createElement('a')
parser.href = document.location.href
var path = parser.pathname
var baseURL = parser.protocol+"//"+parser.host

var username = path.split('/')[1]
var project = path.split('/')[2]

var state = {}

var clientId
if(parser.hostname == "localhost") {
    clientId = "6e3296a6eaa870f520ee50a2f6704d7bcfff3d50db52141f5685424993deb012"
} else {
    clientId = "118ee6aceaf7a16c4f8f83536a334233bc2b22e2c6a286ef7a83fa4a2714f328"
}

if(path == "/") {
    //
}

if(path == "/callback") {
    var callback = parseQuery(window.location.hash)
    if(typeof callback.error == 'undefined') {
        Cookies.set( 'AccessToken', callback.access_token )
    } else {

    }
    window.close()
}

var githubURL = 'https://api.github.com/repos/'+username+'/'+project

if(typeof Cookies.get('GitHubToken') != 'undefined') {
    githubURL = githubURL+'?access_token='+Cookies.get('GitHubToken')
}

$.ajax({
    url: githubURL,
    statusCode: {
        403: function() {
            var github_token = prompt("The GitHub API has been called too many times. You can enter a personal access token to have unlimited access.")
            if(github_token != null) {
                Cookies.set('GitHubToken', github_token)
            }
        }
    },
    success: function(data) {
        state.repo = data
        $.ajax({
            url: 'https://raw.githubusercontent.com/'+username+'/'+project+'/'+state.repo.default_branch+'/project.json',
            success: function(data) {
                state.project = JSON.parse(data)

                var projectTemplate = $('script[name=project]').text()
                var projectHTML = nunjucks.renderString(projectTemplate, state)

                $('body').append(projectHTML)

                $('button').click(function(e) {
                    if(typeof Cookies.get('AccessToken') == 'undefined') {
                        window.open("https://cloud.digitalocean.com/v1/oauth/authorize?response_type=token&client_id="+clientId+"&redirect_uri="+baseURL+"/callback&scope=read+write",
                                    "oauth",
                                    "menubar=1,resizable=1,width=1100,height=700")
                    } else {
                        $('button').off().prop("disabled",true)
                        $('button').text("checking for ssh-keys...")
                        $.ajax({
                            url: 'https://api.digitalocean.com/v2/account/keys',
                            beforeSend: function(xhr){xhr.setRequestHeader('Authorization', 'Bearer '+Cookies.get('AccessToken'))},
                            success: function(data) {
                                state.ssh_keys = data.ssh_keys

                                if(state.ssh_keys.length == 0) {
                                    alert("Your DigitalOcean account must have an active ssh-key.")
                                } else {
                                    $('button').text("creating droplet...")

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
                                            "/tmp/dobutton/node/bin/node /tmp/dobutton/node/lib/node_modules/http-server/bin/http-server /tmp/dobutton/public -p 33333 --cors &",
                                            "curl -L https://raw.githubusercontent.com/"+username+"/"+project+"/"+state.repo.default_branch+"/"+state.project.provision.script+" -o /tmp/provision.sh",
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
                                            state.droplet = data.droplet
                                            
                                            var dropletStatusInterval = setInterval(function() {
                                                $.ajax({
                                                    url: 'https://api.digitalocean.com/v2/droplets/'+state.droplet.id,
                                                    contentType: 'application/json',
                                                    beforeSend: function(xhr){xhr.setRequestHeader('Authorization', 'Bearer '+Cookies.get('AccessToken'))},
                                                    success: function(data) {
                                                        if(data.droplet.status == 'active') {
                                                            state.droplet = data.droplet
                                                            state.droplet.ip = state.droplet.networks.v4[0].ip_address
                                                            clearInterval(dropletStatusInterval)
                                                            $('button').text("running script...")
                                                            var scriptStatusInterval = setInterval(function() {
                                                                $.ajax({
                                                                    url: 'http://'+state.droplet.ip+':33333/state.json',
                                                                    dataType: 'json',
                                                                    success: function(data) {
                                                                        console.log(data)
                                                                        if(data.status == 'complete') {
                                                                            clearInterval(scriptStatusInterval)
                                                                            $('button').prop("disabled",false)
                                                                            $('button').text("GO!")
                                                                            $('button').click(function() {var win = window.open('http://'+state.droplet.networks.v4[0].ip_address, '_blank'); win.focus(); return false})
                                                                            $('fieldset').hide()
                                                                            if(typeof state.project.provision.instructions != 'undefined') {
                                                                                $('button').before('<div class="instructions">'+nunjucks.renderString(md.render(state.project.provision.instructions), state)+'</div>')
                                                                            }
                                                                        }
                                                                    }
                                                                })
                                                            }, 3000)
                                                        }
                                                    }
                                                })
                                            }, 3000)
                                        }
                                    })
                                }
                            }
                        })
                    }
                    return false
                })
            }
        })
    }
})

function parseQuery(qstr) {
    var query = {}
    var a = qstr.substr(1).split('&')
    for (var i = 0; i < a.length; i++) {
        var b = a[i].split('=')
        query[decodeURIComponent(b[0])] = decodeURIComponent(b[1] || '')
    }
    return query
}
